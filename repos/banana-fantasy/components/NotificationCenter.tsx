'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ───────────────────────────────────────────────────────────────

export type NotificationType = 'draft_starting' | 'draft_results' | 'promo' | 'referral' | 'jackpot' | 'hof' | 'jackpot_queue' | 'hof_queue' | 'system' | 'offer_received' | 'offer_accepted' | 'purchase_complete' | 'sale_complete' | 'listing_created';

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
};

const STORAGE_KEY = 'sbs-notifications';
const MAX_NOTIFICATIONS = 50;
const SYNC_EVENT = 'sbs-notifications-sync';
const PREFS_KEY = 'sbs-notification-prefs';

// ─── Notification Categories ────────────────────────────────────────────

export type NotificationCategory = 'drafts' | 'promos' | 'marketplace' | 'special' | 'system';

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
};

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; emoji: string }> = {
  drafts: { label: 'Drafts', emoji: '🏈' },
  promos: { label: 'Promos & Rewards', emoji: '🎁' },
  marketplace: { label: 'Marketplace', emoji: '💰' },
  special: { label: 'Special Drafts', emoji: '🔥' },
  system: { label: 'System & Referrals', emoji: '📢' },
};

export type NotificationPrefs = Record<NotificationCategory, boolean>;

const DEFAULT_PREFS: NotificationPrefs = { drafts: true, promos: true, marketplace: true, special: true, system: true };

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

// ─── localStorage helpers ────────────────────────────────────────────────

function loadNotifications(): Notification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultNotifications();
    const parsed = JSON.parse(raw) as Notification[];
    // Backfill: legacy promo-discovery / claim notifications were created
    // with promo.ctaLink (typically /buy-drafts) — wrong destination for
    // "go see what this is" or "claim your reward". Rewrite them to
    // /promos so the click lands somewhere the user can actually act.
    const PROMO_REDIRECT_TITLES = new Set(['Ready to Claim!', 'New Promo Available!']);
    const remapped = parsed.map((n) => {
      if (PROMO_REDIRECT_TITLES.has(n.title) && n.link && !n.link.startsWith('/promos')) {
        return { ...n, link: '/promos' };
      }
      return n;
    });
    // Self-heal legacy duplicates: collapse to first occurrence per
    // dedupeKey OR per identical title (covers older badge notifications
    // written before dedupeKey existed). Order-preserving so the user's
    // newest entry wins.
    const seenKeys = new Set<string>();
    return remapped.filter((n) => {
      const key = n.metadata?.dedupeKey as string | undefined;
      const isBadgeTitle = n.title.startsWith('Badge unlocked:');
      const dedupeOn = key ?? (isBadgeTitle ? n.title : null);
      if (!dedupeOn) return true;
      if (seenKeys.has(dedupeOn)) return false;
      seenKeys.add(dedupeOn);
      return true;
    });
  } catch {
    return getDefaultNotifications();
  }
}

function saveNotifications(notifs: Notification[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs.slice(0, MAX_NOTIFICATIONS)));
    // Notify other hook instances on this page to re-sync
    window.dispatchEvent(new Event(SYNC_EVENT));
  } catch { /* quota */ }
}

/**
 * Add a notification from anywhere (no hook needed). Updates localStorage + triggers sync.
 *
 * `dedupeKey` (optional): if any existing notification carries the same
 * key in metadata.dedupeKey, the new one is dropped. Use a stable key
 * like `badge-${id}` so a badge can only ever produce one entry, even
 * if the upstream notifier fires multiple times across tabs / mounts /
 * stale localStorage state.
 */
export function pushNotification(notif: { type: NotificationType; title: string; message: string; link?: string; dedupeKey?: string }) {
  if (typeof window === 'undefined') return;
  // Respect user's category preferences
  if (!isCategoryEnabled(notif.type)) return;
  const existing = loadNotifications();
  if (notif.dedupeKey) {
    const collision = existing.some(n => n.metadata?.dedupeKey === notif.dedupeKey);
    if (collision) return;
  }
  const { dedupeKey, ...rest } = notif;
  const newNotif: Notification = {
    ...rest,
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    read: false,
    createdAt: new Date().toISOString(),
    ...(dedupeKey ? { metadata: { dedupeKey } } : {}),
  };
  saveNotifications([newNotif, ...existing]);
}

function getDefaultNotifications(): Notification[] {
  const now = Date.now();
  return [
    {
      id: 'n-1',
      type: 'system',
      title: 'Welcome to BBB4! 🍌',
      message: 'Season 4 is here. Buy your first draft pass and get drafting!',
      read: false,
      createdAt: new Date(now - 60000).toISOString(),
      link: '/buy-drafts',
    },
    {
      id: 'n-2',
      type: 'promo',
      title: 'Welcome Gift Available',
      message: 'Claim 50% off your first draft pass — limited time!',
      read: false,
      createdAt: new Date(now - 300000).toISOString(),
      link: '/buy-drafts',
    },
    {
      id: 'n-3',
      type: 'draft_starting',
      title: 'Draft Starting Soon',
      message: 'Banana Blitz #142 starts in 5 minutes. Get ready!',
      read: false,
      createdAt: new Date(now - 600000).toISOString(),
      link: '/draft-room?id=d-101',
    },
    {
      id: 'n-4',
      type: 'draft_results',
      title: 'Draft Complete — Grade A!',
      message: 'Your team in Peel Party #98 scored an A grade. View your results.',
      read: true,
      createdAt: new Date(now - 86400000).toISOString(),
      link: '/draft-results/d-099',
    },
    {
      id: 'n-5',
      type: 'referral',
      title: 'Referral Bonus Earned!',
      message: 'CryptoKing joined using your link. You earned a free draft pass!',
      read: true,
      createdAt: new Date(now - 172800000).toISOString(),
      link: '/referrals',
    },
    {
      id: 'n-6',
      type: 'jackpot',
      title: 'Jackpot Qualification',
      message: 'You\'ve qualified for the $50K Jackpot pool! Keep drafting for more entries.',
      read: true,
      createdAt: new Date(now - 345600000).toISOString(),
      link: '/jackpot-hof',
    },
  ];
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
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    setNotifications(loadNotifications());

    // Re-sync when another hook instance on this page writes notifications
    const onSync = () => setNotifications(loadNotifications());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const addNotification = useCallback((notif: Omit<Notification, 'id' | 'read' | 'createdAt'>) => {
    setNotifications(prev => {
      const newNotif: Notification = {
        ...notif,
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        read: false,
        createdAt: new Date().toISOString(),
      };
      const updated = [newNotif, ...prev].slice(0, MAX_NOTIFICATIONS);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveNotifications([]);
  }, []);

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  useEffect(() => { setPrefs(getNotificationPrefs()); }, []);

  const toggleCategory = useCallback((cat: NotificationCategory) => {
    setPrefs(prev => {
      const updated = { ...prev, [cat]: !prev[cat] };
      setNotificationPrefs(updated);
      return updated;
    });
  }, []);

  return { notifications, unreadCount, markAsRead, markAllRead, addNotification, clearAll, prefs, toggleCategory };
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
  const { walletAddress } = useAuth();

  const { notifications: localNotifs, unreadCount: localUnread, markAsRead, markAllRead: markAllLocalRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  // Firestore notifications (sold, offers received)
  const [firestoreNotifs, setFirestoreNotifs] = useState<Notification[]>([]);

  useEffect(() => {
    if (!walletAddress) { setFirestoreNotifs([]); return; }

    const fetchRemote = async () => {
      try {
        const res = await fetch(`/api/marketplace/notifications?wallet=${encodeURIComponent(walletAddress)}`);
        if (!res.ok) return;
        const json = await res.json();
        const mapped: Notification[] = (json.notifications ?? []).map((n: Record<string, unknown>) => ({
          id: n.id as string,
          type: (n.type as NotificationType) || 'system',
          title: n.title as string,
          message: n.message as string,
          read: false,
          createdAt: (n.createdAt as string) || new Date().toISOString(),
          link: (n.link as string) || undefined,
        }));
        setFirestoreNotifs(mapped);
      } catch { /* silent */ }
    };

    fetchRemote();
    const interval = setInterval(fetchRemote, 30_000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Merge: Firestore (unread) on top, then local
  const merged = [...firestoreNotifs, ...localNotifs];
  const totalUnread = localUnread + firestoreNotifs.length;

  const handleMarkAllRead = useCallback(async () => {
    markAllLocalRead();
    if (walletAddress && firestoreNotifs.length > 0) {
      setFirestoreNotifs([]);
      try {
        await fetch('/api/marketplace/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress, all: true }),
        });
      } catch { /* silent */ }
    }
  }, [markAllLocalRead, walletAddress, firestoreNotifs.length]);

  return (
    <div className="relative">
      <NotificationBell
        unreadCount={totalUnread}
        onClick={() => setIsOpen(!isOpen)}
      />
      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={merged}
        unreadCount={totalUnread}
        onMarkRead={markAsRead}
        onMarkAllRead={handleMarkAllRead}
      />
    </div>
  );
}
