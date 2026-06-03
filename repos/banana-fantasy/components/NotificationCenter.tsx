'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { subscribeUserEvents } from '@/lib/api/firebase';
import { useToast } from '@/components/ui/Toast';

// ─── Types ───────────────────────────────────────────────────────────────

export type NotificationType = 'draft_starting' | 'draft_results' | 'promo' | 'referral' | 'jackpot' | 'hof' | 'jackpot_queue' | 'hof_queue' | 'system' | 'offer_received' | 'offer_accepted' | 'purchase_complete' | 'sale_complete' | 'listing_created' | 'friend_request' | 'message_received';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

// ─── Config ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<NotificationType, { emoji: string; color: string }> = {
  draft_starting: { emoji: '🏈', color: '#22c55e' },
  draft_results: { emoji: '📊', color: '#3b82f6' },
  promo: { emoji: '🎁', color: '#f59e0b' },
  referral: { emoji: '🔗', color: '#a855f7' },
  jackpot: { emoji: '🎰', color: '#ef4444' },
  hof: { emoji: '🏆', color: '#d4af37' },
  jackpot_queue: { emoji: '🔥', color: '#ef4444' },
  hof_queue: { emoji: '🏆', color: '#d4af37' },
  system: { emoji: '📢', color: '#6b7280' },
  offer_received: { emoji: '💰', color: '#22c55e' },
  offer_accepted: { emoji: '✅', color: '#3b82f6' },
  purchase_complete: { emoji: '🛒', color: '#22c55e' },
  sale_complete: { emoji: '💵', color: '#3b82f6' },
  listing_created: { emoji: '📋', color: '#a855f7' },
  friend_request: { emoji: '👋', color: '#3b82f6' },
  message_received: { emoji: '💬', color: '#22c55e' },
};

const PREFS_KEY = 'sbs-notification-prefs';

// ─── Notification Categories ────────────────────────────────────────────

export type NotificationCategory = 'drafts' | 'promos' | 'marketplace' | 'special' | 'system' | 'friends' | 'messages';

const CATEGORY_MAP: Record<NotificationType, NotificationCategory> = {
  draft_starting: 'drafts',
  draft_results: 'drafts',
  promo: 'promos',
  referral: 'system',
  jackpot: 'special',
  hof: 'special',
  jackpot_queue: 'special',
  hof_queue: 'special',
  system: 'system',
  offer_received: 'marketplace',
  offer_accepted: 'marketplace',
  purchase_complete: 'marketplace',
  sale_complete: 'marketplace',
  listing_created: 'marketplace',
  friend_request: 'friends',
  message_received: 'messages',
};

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; emoji: string }> = {
  drafts: { label: 'Drafts', emoji: '🏈' },
  promos: { label: 'Promos & Rewards', emoji: '🎁' },
  marketplace: { label: 'Marketplace', emoji: '💰' },
  special: { label: 'Special Drafts', emoji: '🔥' },
  system: { label: 'System & Referrals', emoji: '📢' },
  friends: { label: 'Friend Requests', emoji: '👋' },
  messages: { label: 'Messages', emoji: '💬' },
};

export type NotificationPrefs = Record<NotificationCategory, boolean>;

const DEFAULT_PREFS: NotificationPrefs = { drafts: true, promos: true, marketplace: true, special: true, system: true, friends: true, messages: true };

export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

export function setNotificationPrefs(prefs: NotificationPrefs) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function isCategoryEnabled(type: NotificationType): boolean {
  const cat = CATEGORY_MAP[type];
  if (!cat) return true;
  return getNotificationPrefs()[cat] !== false;
}

// ─── Server-backed notification source ───────────────────────────────────
//
// Notifications now live in Firestore per wallet and sync across every device
// (see lib/queueNotifications.ts + app/api/marketplace/notifications/route.ts).
// localStorage is no longer the source of truth — this file only POSTs new
// notifications and reads them back from the server.

// Shared across all useNotifications instances (the header widget + the
// /notifications page can both be mounted) so a mobile poll-driven toast fires
// exactly ONCE per notification, not once per instance.
const _toastedIds = new Set<string>();
let _toastsSeeded = false;

// Current wallet, registered by useNotifications (header-mounted) so the
// standalone pushNotification() helper can attribute POSTs without a hook.
let _notificationWallet: string | null = null;
export function _setNotificationWallet(wallet: string | null) {
  _notificationWallet = wallet ? wallet.toLowerCase() : null;
}

function resolveWallet(): string | null {
  if (_notificationWallet) return _notificationWallet;
  if (typeof window === 'undefined') return null;
  // Fallback: the cached user object (written by useAuth) carries the wallet.
  try {
    const raw = localStorage.getItem('banana-fantasy-user-balance');
    if (raw) {
      const u = JSON.parse(raw) as { walletAddress?: string };
      if (u?.walletAddress) return u.walletAddress.toLowerCase();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Create a notification from anywhere (no hook needed). POSTs to the server
 * so it persists per-wallet and syncs to ALL the user's devices. Pass a
 * stable `dedupeKey` so the same logical event creates exactly one entry even
 * if fired from multiple devices/tabs. Best-effort, fire-and-forget.
 *
 * Note: category mute is applied as a per-device DISPLAY filter (see
 * useNotifications) — NOT here — so muting on one device can't suppress a
 * notification server-side for the user's other devices.
 */
export function pushNotification(notif: { type: NotificationType; title: string; message: string; link?: string; dedupeKey?: string }) {
  if (typeof window === 'undefined') return;
  const wallet = resolveWallet();
  if (!wallet) return;
  void fetch('/api/marketplace/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      link: notif.link,
      dedupeKey: notif.dedupeKey,
    }),
  }).catch(() => { /* best-effort */ });
}

// ─── Time formatting ─────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useNotifications() {
  const { walletAddress } = useAuth();
  const { show } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  // Current notification ids (kept in a ref) so markAllRead can flag them
  // locally-read SYNCHRONOUSLY — fixes "first read-all tap does nothing" where
  // the optimistic update raced a poll refetch.
  const currentIdsRef = useRef<string[]>([]);
  // (toasted-id dedup is module-level — see _toastedIds — so multiple hook
  // instances don't double-toast the same notification.)
  const showRef = useRef(show);
  showRef.current = show;
  const isMobile = typeof navigator !== 'undefined' && /iphone|ipad|ipod|android/i.test(navigator.userAgent);

  // Wallet in a ref so the (stable) refetch closure reads the current value
  // without re-creating — render-loop safety (CLAUDE.md Rule #0): effect deps
  // stay scalar, never Privy-derived callbacks.
  const walletRef = useRef<string | null>(walletAddress ?? null);
  walletRef.current = walletAddress ?? null;

  // Ids we've marked read locally but the server may not have committed yet.
  // A refetch that started before the PATCH committed would return them as
  // UNREAD and clobber the optimistic clear (the "had to tap read-all twice"
  // bug). We force them read until the server confirms, then drop the override.
  const locallyReadRef = useRef<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    const w = walletRef.current;
    if (!w) { setNotifications([]); return; }
    try {
      const res = await fetch(`/api/marketplace/notifications?wallet=${encodeURIComponent(w)}&all=1`);
      if (!res.ok) return;
      const json = await res.json();
      const mapped: Notification[] = (json.notifications ?? []).map((n: Record<string, unknown>) => {
        const id = n.id as string;
        const serverRead = Boolean(n.read);
        // Server confirmed read → local override no longer needed.
        if (serverRead) locallyReadRef.current.delete(id);
        return {
          id,
          type: (n.type as NotificationType) || 'system',
          title: n.title as string,
          message: n.message as string,
          read: serverRead || locallyReadRef.current.has(id),
          createdAt: (n.createdAt as string) || new Date().toISOString(),
          link: (n.link as string) || undefined,
        };
      });
      currentIdsRef.current = mapped.map((n) => n.id);

      // Mobile poll-driven toast: iOS suspends the websocket, so the live
      // event stream (which normally drives toasts) barely reaches mobile.
      // Instead, surface a toast when the POLL discovers a genuinely new,
      // recent, unread notification — the same connection (HTTP) that keeps
      // the bell current. Desktop keeps its websocket-driven toast.
      if (isMobile) {
        if (!_toastsSeeded) {
          // First load: don't toast pre-existing notifications.
          mapped.forEach((n) => _toastedIds.add(n.id));
          _toastsSeeded = true;
        } else {
          const nowMs = Date.now();
          const fresh = mapped.filter((n) =>
            !n.read
            && !_toastedIds.has(n.id)
            && (nowMs - new Date(n.createdAt).getTime()) < 60_000, // created within last 60s
          );
          fresh.forEach((n) => _toastedIds.add(n.id));
          // Toast at most the 2 newest so a late batch doesn't spam.
          fresh.slice(0, 2).forEach((n) => {
            showRef.current({
              level: 'success',
              message: n.title,
              ...(n.link ? { action: { label: 'View', onClick: () => { window.location.href = n.link as string; } } } : {}),
            });
          });
        }
      }

      setNotifications(mapped);
    } catch { /* silent — degrade to last-known list */ }
  }, [isMobile]);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Initial load + 30s poll + register wallet for the standalone
  // pushNotification() helper. Deps: walletAddress only (stable scalar).
  useEffect(() => {
    _setNotificationWallet(walletAddress ?? null);
    if (!walletAddress) { setNotifications([]); return; }
    refetchRef.current();
    // Mobile PWAs suspend the realtime websocket, so live pings can be minutes
    // late there — poll tightly on mobile so the bell stays near-real-time
    // regardless. Desktop keeps the websocket (fast) + a slow safety poll.
    const isMobile = typeof navigator !== 'undefined' && /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    const poll = setInterval(() => refetchRef.current(), isMobile ? 5_000 : 30_000);
    return () => clearInterval(poll);
  }, [walletAddress]);

  // Real-time: refetch on any user-event stream ping, coalesced to one refetch
  // per ~300ms burst (fast enough to feel instant, still storm-safe — the
  // render-loop guard caps at 75 /api/* req / 10s). Also refetch the instant
  // the user focuses this device/tab (covers the "read on desktop, pick up
  // phone" case where the backgrounded tab's stream connection was throttled).
  useEffect(() => {
    if (!walletAddress) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const coalesced = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; refetchRef.current(); }, 300);
    };
    const onEvent = (event: { type: string; timestamp?: number; source?: string; notifId?: string; notifType?: string; notifTitle?: string; notifMessage?: string; notifLink?: string }) => {
      // DIAGNOSTIC: server-fire → client-receive latency for cross-device sync.
      import('@/lib/clientLog').then(({ clientLog, deviceTag }) => clientLog('sync#', 'bell.ping.recv', {
        type: event.type, src: event.source ?? null,
        ageMs: event.timestamp ? Date.now() - event.timestamp : null,
        dev: deviceTag(),
      })).catch(() => {});
      // INSTANT render: a content-carrying 'notification' ping for a FRESH
      // event (just happened) → prepend the entry immediately, no fetch wait.
      // The freshness gate stops replayed RTDB history (onChildAdded fires for
      // every existing child on subscribe) from injecting stale entries.
      const fresh = event.timestamp ? (Date.now() - event.timestamp < 30_000) : false;
      if (fresh && event.type === 'notification' && event.notifTitle && event.notifId) {
        const id = event.notifId;
        setNotifications((prev) => {
          if (prev.some((n) => n.id === id)) return prev; // dedup
          const entry: Notification = {
            id,
            type: (event.notifType as NotificationType) || 'system',
            title: event.notifTitle as string,
            message: event.notifMessage || '',
            read: false,
            createdAt: new Date().toISOString(),
            link: event.notifLink || undefined,
          };
          return [entry, ...prev];
        });
      }
      coalesced(); // reconcile read-state/ordering shortly after
    };
    const unsub = subscribeUserEvents(walletAddress, onEvent);
    const onFocus = () => { if (document.visibilityState !== 'hidden') coalesced(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      try { unsub(); } catch { /* ignore */ }
    };
  }, [walletAddress]);

  // Category mute prefs — per-device DISPLAY filter (Phase 1). Phase 2 syncs
  // these to the account.
  useEffect(() => { setPrefs(getNotificationPrefs()); }, []);

  const visible = useMemo(
    () => notifications.filter(n => isCategoryEnabled(n.type)),
    // prefs in deps so the filter recomputes when a category is toggled.
    [notifications, prefs],
  );
  const unreadCount = visible.filter(n => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    locallyReadRef.current.add(id); // protect from a stale refetch un-reading it
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)); // optimistic
    const w = walletRef.current;
    if (!w) return;
    void fetch('/api/marketplace/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: w, ids: [id] }),
    }).catch(() => refetchRef.current());
  }, []);

  const markAllRead = useCallback(() => {
    // Flag every current id locally-read SYNCHRONOUSLY (from the ref, not inside
    // the state updater) so an in-flight poll refetch can't bring the badge back
    // — this is what made the first tap appear to do nothing on mobile.
    currentIdsRef.current.forEach(id => locallyReadRef.current.add(id));
    setNotifications(prev => prev.map(n => ({ ...n, read: true }))); // optimistic
    const w = walletRef.current;
    // DIAGNOSTIC: did read-all fire, and with a wallet?
    import('@/lib/clientLog').then(({ clientLog, deviceTag }) => clientLog('sync#', 'markAllRead', { hasWallet: !!w, dev: deviceTag() })).catch(() => {});
    if (!w) return;
    void fetch('/api/marketplace/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: w, all: true }),
    })
      .then((r) => { import('@/lib/clientLog').then(({ clientLog, deviceTag }) => clientLog('sync#', 'markAllRead.patch', { ok: r.ok, status: r.status, dev: deviceTag() })).catch(() => {}); })
      .catch(() => refetchRef.current());
  }, []);

  // Persist server-side; the resulting 'notification' ping refetches the bell.
  const addNotification = useCallback((notif: Omit<Notification, 'id' | 'read' | 'createdAt'>) => {
    pushNotification({
      type: notif.type,
      title: notif.title,
      message: notif.message,
      link: notif.link,
      dedupeKey: notif.metadata?.dedupeKey as string | undefined,
    });
  }, []);

  // "Clear" = mark everything read (keeps a synced history; no destructive delete).
  const clearAll = useCallback(() => { markAllRead(); }, [markAllRead]);

  const toggleCategory = useCallback((cat: NotificationCategory) => {
    setPrefs(prev => {
      const updated = { ...prev, [cat]: !prev[cat] };
      setNotificationPrefs(updated);
      return updated;
    });
  }, []);

  return { notifications: visible, unreadCount, markAsRead, markAllRead, addNotification, clearAll, prefs, toggleCategory };
}

// ─── Bell Icon Button ────────────────────────────────────────────────────

export function NotificationBell({ unreadCount, onClick }: { unreadCount: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Notifications${unreadCount > 0 ? `: ${unreadCount} unread` : ''}`}
      className="relative flex items-center px-3 py-2 rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
    >
      <span className="text-xl" aria-hidden="true">🔔</span>
      {unreadCount > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </motion.span>
      )}
    </button>
  );
}

// ─── Dropdown Panel ──────────────────────────────────────────────────────

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationPanel({ isOpen, onClose, notifications, unreadCount, onMarkRead, onMarkAllRead }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute right-0 top-full mt-2 w-[340px] sm:w-[380px] max-h-[480px] bg-bg-secondary border border-bg-tertiary rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-tertiary">
            <div className="flex items-center gap-2">
              <h3 className="text-text-primary font-bold text-sm">Notifications</h3>
              {unreadCount > 0 && (
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="text-banana text-[11px] font-medium hover:underline"
                >
                  Mark all read
                </button>
              )}
              <Link
                href="/notifications"
                onClick={onClose}
                className="text-text-muted text-[11px] hover:text-text-primary transition-colors"
              >
                View all →
              </Link>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[400px] divide-y divide-bg-tertiary/50">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <span className="text-3xl opacity-30">🔔</span>
                <p className="text-text-muted text-xs mt-2">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 15).map((notif, i) => {
                const config = TYPE_CONFIG[notif.type];
                const content = (
                  <motion.div
                    initial={i < 5 ? { opacity: 0, x: -8 } : false}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    onClick={() => {
                      if (!notif.read) onMarkRead(notif.id);
                      if (notif.link) onClose();
                    }}
                    className={`flex gap-3 px-4 py-3 hover:bg-bg-tertiary/40 transition-colors cursor-pointer ${
                      !notif.read ? 'bg-banana/[0.03]' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
                      style={{ backgroundColor: `${config.color}15` }}
                    >
                      {config.emoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-semibold leading-tight ${!notif.read ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <div className="w-2 h-2 rounded-full bg-banana flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-text-muted text-[11px] mt-0.5 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                      <p className="text-text-muted/50 text-[10px] mt-1">{timeAgo(notif.createdAt)}</p>
                    </div>
                  </motion.div>
                );

                return notif.link ? (
                  <Link key={notif.id} href={notif.link} className="block">
                    {content}
                  </Link>
                ) : (
                  <div key={notif.id}>{content}</div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 15 && (
            <div className="px-4 py-2.5 border-t border-bg-tertiary text-center">
              <Link
                href="/notifications"
                onClick={onClose}
                className="text-banana text-xs font-medium hover:underline"
              >
                View all {notifications.length} notifications
              </Link>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Combined Header Widget ─────────────────────────────────────────────

export function NotificationWidget() {
  // Single server-backed source of truth (synced across devices).
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <NotificationBell
        unreadCount={unreadCount}
        onClick={() => setIsOpen(!isOpen)}
      />
      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkRead={markAsRead}
        onMarkAllRead={markAllRead}
      />
    </div>
  );
}
