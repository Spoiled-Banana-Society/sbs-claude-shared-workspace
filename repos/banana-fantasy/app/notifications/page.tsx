'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications, type NotificationType } from '@/components/NotificationCenter';
import { NotificationIcon } from '@/components/NotificationIcons';

const TYPE_CONFIG: Record<NotificationType, { emoji: string; color: string; label: string }> = {
  draft_starting: { emoji: '🏈', color: '#22c55e', label: 'Draft' },
  draft_results: { emoji: '📊', color: '#3b82f6', label: 'Results' },
  promo: { emoji: '🎁', color: '#f59e0b', label: 'Promo' },
  referral: { emoji: '🔗', color: '#a855f7', label: 'Referral' },
  jackpot: { emoji: '🎰', color: '#ef4444', label: 'Jackpot' },
  hof: { emoji: '🏆', color: '#d4af37', label: 'HOF' },
  jackpot_queue: { emoji: '🔥', color: '#ef4444', label: 'Jackpot' },
  hof_queue: { emoji: '🏆', color: '#d4af37', label: 'HOF' },
  jackhof_queue: { emoji: '🔥', color: '#ef6c37', label: 'JackHOF' },
  system: { emoji: '📢', color: '#6b7280', label: 'System' },
  offer_received: { emoji: '💰', color: '#22c55e', label: 'Offer' },
  offer_accepted: { emoji: '✅', color: '#3b82f6', label: 'Offer' },
  purchase_complete: { emoji: '🛒', color: '#22c55e', label: 'Purchase' },
  sale_complete: { emoji: '💵', color: '#3b82f6', label: 'Sale' },
  listing_created: { emoji: '📋', color: '#a855f7', label: 'Listing' },
  friend_request: { emoji: '👋', color: '#3b82f6', label: 'Friend' },
  message_received: { emoji: '💬', color: '#22c55e', label: 'Message' },
  welcome: { emoji: '🎉', color: '#fbbf24', label: 'Welcome' },
  prize: { emoji: '💰', color: '#22c55e', label: 'Prize' },
  prize_won: { emoji: '💰', color: '#22c55e', label: 'Prize' },
  withdrawal_paid: { emoji: '✅', color: '#22c55e', label: 'Cash Out' },
  withdrawal_denied: { emoji: '⚠️', color: '#ef4444', label: 'Cash Out' },
  base_guide: { emoji: '⚡', color: '#fbbf24', label: 'Base' },
  app_download: { emoji: '📱', color: '#fbbf24', label: 'App' },
  founder_draft: { emoji: '👑', color: '#06b6d4', label: 'Founder' },
  draft_alerts: { emoji: '🔔', color: '#fbbf24', label: 'Draft Alerts' },
};

const FALLBACK_TYPE_CONFIG = { emoji: '🔔', color: '#6b7280', label: 'Notification' };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.03, duration: 0.25, ease: 'easeOut' as const },
  }),
};

type FilterKey = 'all' | 'unread';

export default function NotificationsPage() {
  const { notifications, unreadCount, markAsRead, markAllRead, unpin, hasLoaded } = useNotifications();
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(
    () => (filter === 'unread' ? notifications.filter(n => !n.read) : notifications),
    [notifications, filter],
  );

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: `All (${notifications.length})` },
    { key: 'unread', label: `Unread (${unreadCount})` },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-6 sm:py-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <div>
            <h1 className="text-white text-2xl sm:text-3xl font-bold">Notifications</h1>
            <p className="text-white/40 text-sm mt-1">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up 🍌'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-banana/10 text-banana text-xs font-bold rounded-lg border border-banana/20 hover:bg-banana/20 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Mark all read
            </button>
          )}
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-hide"
        >
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all ${
                filter === f.key
                  ? 'bg-banana text-black'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
              }`}
            >
              {f.label}
            </button>
          ))}
        </motion.div>

        {/* Notification List */}
        <div className="space-y-1.5">
          {!hasLoaded && notifications.length === 0 ? (
            // Loading skeleton — never flash "No notifications" before the list loads
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 sm:gap-4 p-4 rounded-xl border border-white/[0.04] bg-white/[0.02]">
                  <div className="w-9 h-9 rounded-full bg-white/[0.05] animate-pulse flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2 py-1">
                    <div className="h-3.5 w-1/3 bg-white/[0.06] rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-white/[0.04] rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <div className="text-4xl mb-3 opacity-30">🔔</div>
                <p className="text-white/30 text-sm">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
                </p>
              </motion.div>
            ) : (
              filtered.map((notif, i) => {
                const config = TYPE_CONFIG[notif.type] ?? FALLBACK_TYPE_CONFIG;
                const inner = (
                  <motion.div
                    key={notif.id}
                    custom={i}
                    variants={fadeIn}
                    initial="hidden"
                    animate="visible"
                    exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                    layout
                    onClick={() => { if (!notif.read) markAsRead(notif.id); }}
                    className={`group/row flex gap-3 sm:gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                      notif.pinned
                        ? `border-banana/60 ${!notif.read ? 'bg-banana/[0.05] hover:bg-banana/[0.07]' : 'bg-white/[0.02] hover:bg-white/[0.04]'}`
                        : (!notif.read
                          ? 'bg-banana/[0.04] border-banana/10 hover:bg-banana/[0.06]'
                          : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]')
                    }`}
                  >
                    {/* Icon — quiet grey, no tile, so the message text leads */}
                    <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
                      <NotificationIcon icon={notif.icon} type={notif.type} color="rgba(255,255,255,0.5)" size={20} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {notif.pinned && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-bold tracking-[0.16em] text-banana">PINNED</span>
                          <button
                            type="button"
                            aria-label="Dismiss pinned notification"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); unpin(notif.id); }}
                            className="-mr-1 -mt-1 w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-semibold ${!notif.read ? 'text-white' : 'text-white/70'}`}>
                              {notif.title}
                            </p>
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={{ color: config.color, backgroundColor: `${config.color}15` }}
                            >
                              {config.label}
                            </span>
                          </div>
                          {typeof (notif as { liveAtMs?: number }).liveAtMs === 'number' && (
                            <p className="text-banana text-xs mt-1 font-extrabold">
                              {Date.now() < (notif as { liveAtMs?: number }).liveAtMs!
                                ? (() => { const mins = Math.max(1, Math.ceil(((notif as { liveAtMs?: number }).liveAtMs! - Date.now()) / 60_000)); return mins < 90 ? `Starts in ${mins} min` : mins < 60 * 30 ? `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m` : `Starts in ${Math.round(mins / 1440)} days`; })()
                                : '🔴 LIVE NOW'}
                            </p>
                          )}
                          <p className="text-white/40 text-xs mt-1 leading-relaxed whitespace-pre-line">{notif.message}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!notif.read && <div className="w-2.5 h-2.5 rounded-full bg-banana" />}
                        </div>
                      </div>
                      <p className="text-white/20 text-[10px] mt-1.5">{timeAgo(notif.createdAt)}</p>
                    </div>
                  </motion.div>
                );

                if (notif.link && notif.link.includes('support=open')) {
                  // Support-chat noti: open the Crisp widget in place.
                  return (
                    <div
                      key={notif.id}
                      className="block cursor-pointer"
                      onClick={() => { try { window.dispatchEvent(new Event('sbs:open-support')); } catch { /* no-op */ } }}
                    >
                      {inner}
                    </div>
                  );
                }
                return notif.link ? (
                  <Link key={notif.id} href={notif.link} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={notif.id}>{inner}</div>
                );
              })
            )}
          </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
