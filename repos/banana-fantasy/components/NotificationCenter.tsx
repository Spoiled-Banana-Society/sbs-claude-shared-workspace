'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { subscribeUserEvents } from '@/lib/api/firebase';
import { useToast } from '@/components/ui/Toast';
import { NotificationIcon } from '@/components/NotificationIcons';

// ─── Types ───────────────────────────────────────────────────────────────

export type NotificationType = 'draft_starting' | 'draft_results' | 'promo' | 'referral' | 'jackpot' | 'hof' | 'jackpot_queue' | 'hof_queue' | 'system' | 'offer_received' | 'offer_accepted' | 'purchase_complete' | 'sale_complete' | 'listing_created' | 'friend_request' | 'message_received' | 'welcome' | 'prize' | 'prize_won' | 'withdrawal_paid' | 'withdrawal_denied' | 'base_guide' | 'app_download' | 'founder_draft';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
  /** Per-notification icon (emoji/glyph). Falls back to the type emoji when absent. */
  icon?: string;
  metadata?: Record<string, unknown>;
}

// ─── Config ──────────────────────────────────────────────────────────────

// Support-chat notis don't navigate — they open the Crisp widget in place.
// CrispChat listens for this event; a full page load with ?support=open is
// the fallback for cold starts.
function isSupportLink(link: string | undefined | null): boolean {
  return !!link && link.includes('support=open');
}
function openSupportChat() {
  try { window.dispatchEvent(new Event('sbs:open-support')); } catch { /* no-op */ }
}


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
  welcome: 'promos',
  prize: 'system',
  prize_won: 'system',
  withdrawal_paid: 'system',
  withdrawal_denied: 'system',
  base_guide: 'system',
  app_download: 'system',
  founder_draft: 'drafts',
};

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; emoji: string }> = {
  drafts: { label: 'Drafts', emoji: '🏈' },
  promos: { label: 'Promos & Rewards', emoji: '🎁' },
  marketplace: { label: 'Marketplace', emoji: '💰' },
  special: { label: 'Jackpot & HOF', emoji: '🔥' },
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
export function pushNotification(notif: { type: NotificationType; title: string; message: string; link?: string; dedupeKey?: string; icon?: string }) {
  if (typeof window === 'undefined') return;
  const wallet = resolveWallet();
  if (!wallet) return;
  // INSTANT local render: when a dedupeKey is provided we can predict the
  // server doc id (mirrors dedupeDocId in lib/queueNotifications.ts), so the
  // bell on THIS device shows the entry the same millisecond — no waiting on
  // the POST → Firestore → RTDB round trip (which read as a ~2s late ping,
  // e.g. after the wheel stopped). The server copy reconciles under the same
  // id, so nothing duplicates.
  if (notif.dedupeKey) {
    const id = `${wallet}__${notif.dedupeKey}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
    window.dispatchEvent(new CustomEvent('sbs-notifs-local', {
      detail: {
        id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        link: notif.link,
        icon: notif.icon,
        createdAt: new Date().toISOString(),
        read: false,
      },
    }));
  }
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
      icon: notif.icon,
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
  // Soft client-side navigation for toast "View" — a hard window.location
  // reload forced a full Privy re-hydration, which could bounce a freshly
  // logged-in account back to logged-out (caught by Boris 2026-06-10).
  const router = useRouter();
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
  // "Mark all read" high-water mark (client ms). Per-id tracking (locallyReadRef)
  // only covers notifications already LOADED — but on mobile a refetch storm
  // (iOS reconnect replays old pings, the mark-read PATCH fires its own ping)
  // plus server-created-but-not-yet-fetched entries kept resurfacing as unread,
  // so the badge bounced back and you had to tap read-all 3-4 times. This is the
  // robust fix: anything created at/before the instant you tapped read-all is
  // READ, full stop — no matter what a stale refetch or replayed ping claims.
  // Notifications created AFTER this instant still show unread as normal.
  const readAllAtRef = useRef<number>(0);
  // Signature of the last list we rendered (id + read flag per item). The mobile
  // poll + the iOS-reconnect ping flood fire a refetch every ~1-2s; if we call
  // setNotifications every time — even when the data is byte-identical — the whole
  // list re-renders with framer-motion layout animations, and a tap landing during
  // that re-render gets eaten (the "first tap highlights but does nothing, second
  // tap works" bug). We only setState when something actually changed.
  const lastSigRef = useRef<string>('');
  // Optimistic entries injected locally by pushNotification (id → entry).
  // A refetch racing the POST would return a list WITHOUT the just-pushed
  // entry and wipe it from the bell; we re-merge anything younger than 15s
  // until the server copy (same deterministic id) shows up.
  const localEntriesRef = useRef<Map<string, Notification>>(new Map());

  const refetch = useCallback(async () => {
    const w = walletRef.current;
    if (!w) { setNotifications([]); return; }
    try {
      const res = await fetch(`/api/marketplace/notifications?wallet=${encodeURIComponent(w)}&all=1`);
      if (!res.ok) return;
      const json = await res.json();
      let mapped: Notification[] = (json.notifications ?? []).map((n: Record<string, unknown>) => {
        const id = n.id as string;
        const serverRead = Boolean(n.read);
        // Server confirmed read → local override no longer needed.
        if (serverRead) locallyReadRef.current.delete(id);
        const createdAt = (n.createdAt as string) || new Date().toISOString();
        // High-water mark: created at/before the last read-all tap → READ,
        // even if the server hasn't committed yet or this is a replayed ping.
        const beforeReadAll = new Date(createdAt).getTime() <= readAllAtRef.current;
        return {
          id,
          type: (n.type as NotificationType) || 'system',
          title: n.title as string,
          message: n.message as string,
          read: serverRead || locallyReadRef.current.has(id) || beforeReadAll,
          createdAt,
          link: (n.link as string) || undefined,
          icon: (n.icon as string) || undefined,
        };
      });
      // Re-merge optimistic local entries the server hasn't returned yet
      // (POST still in flight). Expire after 15s — by then the server copy
      // either landed under the same id or the POST genuinely failed.
      if (localEntriesRef.current.size > 0) {
        const nowMs = Date.now();
        const serverIds = new Set(mapped.map((n) => n.id));
        for (const [id, entry] of localEntriesRef.current) {
          if (serverIds.has(id) || nowMs - new Date(entry.createdAt).getTime() > 15_000) {
            localEntriesRef.current.delete(id);
          } else {
            mapped = [entry, ...mapped];
          }
        }
      }
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
          // Skip notifications that already have their own pop-up/modal or
          // reveal animation — claims (banana-shower) and wheel wins (reveal).
          // "Pop-up → no toast." Matches "Promo Claimed!", "...Won!", "...Queued!".
          const hasOwnPopup = (title: string) => /Promo Claimed|Won!|Queued!/i.test(title || '');
          const fresh = mapped.filter((n) =>
            !n.read
            && !_toastedIds.has(n.id)
            && !hasOwnPopup(n.title)
            && (nowMs - new Date(n.createdAt).getTime()) < 60_000, // created within last 60s
          );
          fresh.forEach((n) => _toastedIds.add(n.id));
          // Toast at most the 2 newest so a late batch doesn't spam.
          fresh.slice(0, 2).forEach((n) => {
            showRef.current({
              level: 'success',
              message: n.title,
              ...(n.link ? { action: { label: 'View', onClick: () => { if (isSupportLink(n.link)) openSupportChat(); else router.push(n.link as string); } } } : {}),
            });
          });
        }
      }

      // Skip the re-render when the list is unchanged (same ids + same read
      // flags, same order). This is what kills the every-~2s re-render storm
      // that was eating the first read-all tap on mobile.
      const sig = mapped.map((n) => `${n.id}:${n.read ? 1 : 0}`).join(',');
      if (sig === lastSigRef.current) return; // nothing new — don't thrash the list (stable tap targets)
      lastSigRef.current = sig;

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
    const onEvent = (event: { type: string; timestamp?: number; source?: string; notifId?: string; notifType?: string; notifTitle?: string; notifMessage?: string; notifLink?: string; notifIcon?: string }) => {
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
            // A replayed ping for something that predates the last read-all tap
            // arrives already-read (don't resurrect a cleared badge); genuinely
            // new events (timestamp after read-all) inject as unread.
            read: event.timestamp ? event.timestamp <= readAllAtRef.current : false,
            createdAt: new Date().toISOString(),
            link: event.notifLink || undefined,
            icon: event.notifIcon || undefined,
          };
          return [entry, ...prev];
        });
      }
      coalesced(); // reconcile read-state/ordering shortly after
    };
    const unsub = subscribeUserEvents(walletAddress, onEvent);
    const onFocus = () => { if (document.visibilityState !== 'hidden') coalesced(); };
    // Local-action nudge: the device that just claimed/purchased dispatches
    // this (lib/localSurfaceDedupe.requestBellRefetch) so its bell updates
    // instantly even where the RTDB socket is suspended (iOS PWA).
    const onLocalRefetch = () => coalesced();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('sbs-notifs-refetch', onLocalRefetch);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('sbs-notifs-refetch', onLocalRefetch);
      try { unsub(); } catch { /* ignore */ }
    };
  }, [walletAddress]);

  // Instant local insert from pushNotification (same-device, zero-latency —
  // e.g. the wheel-stop win noti appears the millisecond the wheel stops,
  // not after the POST→Firestore→ping round trip). Server copy reconciles
  // under the same deterministic id, so refetches dedupe naturally.
  useEffect(() => {
    const onLocal = (e: Event) => {
      const entry = (e as CustomEvent).detail as Notification | undefined;
      if (!entry?.id || !entry.title) return;
      _toastedIds.add(entry.id); // acting device has its own pop-up — never poll-toast this
      localEntriesRef.current.set(entry.id, entry);
      setNotifications((prev) => {
        if (prev.some((n) => n.id === entry.id)) return prev;
        currentIdsRef.current = [entry.id, ...currentIdsRef.current];
        return [entry, ...prev];
      });
    };
    window.addEventListener('sbs-notifs-local', onLocal);
    return () => window.removeEventListener('sbs-notifs-local', onLocal);
  }, []);

  // Cross-instance read-all: the bell badge (header) and the /notifications
  // page are SEPARATE useNotifications instances. Without this, "mark all read"
  // on one clears it but the other's badge lingers until its own poll (~5s on
  // mobile) — which felt like "I had to tap it twice". Broadcasting clears
  // every mounted instance instantly.
  useEffect(() => {
    const onReadAll = () => {
      readAllAtRef.current = Date.now();
      currentIdsRef.current.forEach((id) => locallyReadRef.current.add(id));
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    };
    window.addEventListener('sbs-notifs-markallread', onReadAll);
    return () => window.removeEventListener('sbs-notifs-markallread', onReadAll);
  }, []);

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
    // Set the read-all high-water mark FIRST (synchronously): everything created
    // up to this instant is read, even entries not yet loaded or replayed later.
    // This is what makes ONE tap stick on mobile (no more 3-4 taps).
    readAllAtRef.current = Date.now();
    // Flag every current id locally-read SYNCHRONOUSLY (from the ref, not inside
    // the state updater) so an in-flight poll refetch can't bring the badge back
    // — this is what made the first tap appear to do nothing on mobile.
    currentIdsRef.current.forEach(id => locallyReadRef.current.add(id));
    setNotifications(prev => prev.map(n => ({ ...n, read: true }))); // optimistic
    // Clear every other mounted instance (header badge ↔ /notifications page) now.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sbs-notifs-markallread'));
    const w = walletRef.current;
    if (!w) return;
    void fetch('/api/marketplace/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: w, all: true }),
    }).catch(() => refetchRef.current());
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
      className="group relative flex items-center px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3E216]"
    >
      {/* Clean line bell (Option C) — replaces the 🔔 emoji */}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="text-white/75 group-hover:text-white transition-colors" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
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
                    {/* Icon — quiet grey, no tile, so the message text leads */}
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                      <NotificationIcon icon={notif.icon} type={notif.type} color="rgba(255,255,255,0.5)" size={20} />
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

                if (isSupportLink(notif.link)) {
                  // Open the Crisp widget in place instead of navigating.
                  return (
                    <div key={notif.id} className="block cursor-pointer" onClick={openSupportChat}>
                      {content}
                    </div>
                  );
                }
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
