'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications, type NotificationType, type NotificationCategory, CATEGORY_LABELS } from '@/components/NotificationCenter';
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

type FilterKey = 'all' | 'unread' | NotificationType;

export default function NotificationsPage() {
  const { notifications, unreadCount, markAsRead, markAllRead, prefs, toggleCategory } = useNotifications();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showPrefs, setShowPrefs] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'unread') return notifications.filter(n => !n.read);
    return notifications.filter(n => n.type === filter);
  }, [notifications, filter]);

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: `All (${notifications.length})` },
    { key: 'unread', label: `Unread (${unreadCount})` },
    { key: 'draft_starting', label: '🏈 Drafts' },
    { key: 'promo', label: '🎁 Promos' },
    { key: 'referral', label: '🔗 Referrals' },
    { key: 'system', label: '📢 System' },
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
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="px-3 py-1.5 bg-banana/10 text-banana text-xs font-bold rounded-lg hover:bg-banana/20 transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className={`p-1.5 rounded-lg transition-colors ${showPrefs ? 'bg-banana/20 text-banana' : 'bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/50'}`}
              title="Notification settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </motion.div>

        {/* Category Preferences */}
        {showPrefs && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Notification Categories</p>
            <div className="space-y-2">
              {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-sm text-white/70">
                    {CATEGORY_LABELS[cat].emoji} {CATEGORY_LABELS[cat].label}
                  </span>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${prefs[cat] ? 'bg-banana' : 'bg-white/10'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${prefs[cat] ? 'left-[18px]' : 'left-0.5'}`} />
                  </div>
                </button>
              ))}
            </div>
            <Link
              href="/profile?tab=notifications"
              className="mt-3 flex items-center justify-between rounded-lg border border-banana/20 bg-banana/[0.06] px-3 py-2 text-sm text-banana hover:bg-banana/10 transition-colors"
            >
              <span>🔔 Draft alert channels — push, email, Telegram, Discord</span>
              <span aria-hidden>→</span>
            </Link>
          </motion.div>
        )}

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
                    className={`flex gap-3 sm:gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                      !notif.read
                        ? 'bg-banana/[0.04] border-banana/10 hover:bg-banana/[0.06]'
                        : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Icon */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                      style={{ backgroundColor: `${config.color}15` }}
                    >
                      <NotificationIcon icon={notif.icon} type={notif.type} color={config.color} size={20} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
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
                          <p className="text-white/40 text-xs mt-1 leading-relaxed">{notif.message}</p>
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
        </div>
      </div>
    </div>
  );
}
