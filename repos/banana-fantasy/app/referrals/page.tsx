'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

// ─── Types ───────────────────────────────────────────────────────────────

interface ReferralData {
  code: string | null;
  link: string | null;
  clicks: number;
  signups: number;
  bonusesEarned: number;
  referrals: Array<{
    userId: string;
    username: string;
    joinedAt: string;
    bonusCredited: boolean;
  }>;
}

interface LeaderEntry {
  rank: number;
  username: string;
  referrals: number;
  earned: number;
}

// ─── Mock Leaderboard ────────────────────────────────────────────────────

const MOCK_LEADERBOARD: LeaderEntry[] = [
  { rank: 1, username: 'CryptoKing', referrals: 47, earned: 47 },
  { rank: 2, username: 'DraftGod', referrals: 31, earned: 31 },
  { rank: 3, username: 'BananaFan', referrals: 24, earned: 24 },
  { rank: 4, username: 'NFLWhiz', referrals: 19, earned: 19 },
  { rank: 5, username: 'PickMaster', referrals: 15, earned: 15 },
  { rank: 6, username: 'GridIron', referrals: 12, earned: 12 },
  { rank: 7, username: 'TD_Hunter', referrals: 9, earned: 9 },
  { rank: 8, username: 'WaiverWire', referrals: 7, earned: 7 },
  { rank: 9, username: 'SleepKing', referrals: 5, earned: 5 },
  { rank: 10, username: 'RookieRush', referrals: 3, earned: 3 },
];

// ─── Animations ──────────────────────────────────────────────────────────

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3, ease: 'easeOut' as const },
  }),
};

// ─── Component ───────────────────────────────────────────────────────────

export default function ReferralsPage() {
  const { user, login } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [tab, setTab] = useState<'stats' | 'leaderboard'>('stats');

  const userId = user?.walletAddress || '';
  const username = user?.username || '';

  // Fetch referral data. Passing the display name keeps the name-based code
  // (/r/BorisV) in sync if they renamed since the code was minted.
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`/api/referrals?userId=${encodeURIComponent(userId)}${username ? `&username=${encodeURIComponent(username)}` : ''}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        reportClientError({
          source: LOG_SOURCES.referral.DATA_FETCH_FAILED,
          message: err instanceof Error ? err.message : String(err),
          route: 'referrals',
          context: { userId },
          stack: err instanceof Error ? err.stack : undefined,
        });
      })
      .finally(() => setLoading(false));
  }, [userId, username]);

  // Generate code
  const handleGenerate = useCallback(async () => {
    if (!userId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, username }),
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      // silent
      reportClientError({
        source: LOG_SOURCES.referral.CODE_GENERATION_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'referrals',
        context: { userId, username },
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      setGenerating(false);
    }
  }, [userId, username, generating]);

  // Copy helpers
  const copyToClipboard = useCallback((text: string, type: 'code' | 'link') => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Share helpers
  const shareTwitter = useCallback(() => {
    if (!data?.link) return;
    const text = encodeURIComponent(`Join me on Banana Best Ball! 🍌🏈 Use my referral link and we both get a free draft pass:\n\n${data.link}\n\n#BBB4 #FantasyFootball @SBSFantasy`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  }, [data?.link]);

  const shareDiscord = useCallback(() => {
    if (!data?.link) return;
    const text = encodeURIComponent(`🍌 Join me on Banana Best Ball! Use my link and we both get a free draft pass: ${data.link}`);
    navigator.clipboard.writeText(decodeURIComponent(text)).catch(() => {});
    setCopied('link');
    setTimeout(() => setCopied(null), 2000);
  }, [data?.link]);

  // ─── Not logged in ───
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-sm">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-white text-2xl font-bold mb-2">Refer Friends, Earn Rewards</h1>
          <p className="text-white/40 text-sm mb-6">Log in to get your unique referral link and start earning free draft passes.</p>
          <button onClick={() => login()} className="px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all">
            Connect Wallet
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-6 sm:py-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-white text-2xl sm:text-3xl font-bold">Refer & Earn</h1>
          <p className="text-white/40 text-sm mt-1">
            Share your link. You both get a <span className="text-banana font-semibold">free draft pass</span>.
          </p>
        </motion.div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3 mb-6"
        >
          {[
            { step: '1', emoji: '🔗', title: 'Share Link', desc: 'Send your unique referral link' },
            { step: '2', emoji: '👋', title: 'Friend Joins', desc: 'They sign up via your link' },
            { step: '3', emoji: '🎟️', title: 'Both Earn', desc: 'You both get a free draft pass' },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              custom={i}
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center"
            >
              <span className="text-2xl">{item.emoji}</span>
              <h3 className="text-white font-semibold text-xs mt-2">{item.title}</h3>
              <p className="text-white/30 text-[10px] mt-0.5">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Referral Code Card */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="bg-gradient-to-br from-banana/10 to-transparent border border-banana/20 rounded-2xl p-5 sm:p-6 mb-6"
        >
          {loading ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-white/10 rounded animate-pulse w-1/2" />
                </div>
              </div>
              <div className="h-12 bg-white/10 rounded-xl animate-pulse" />
              <div className="grid grid-cols-3 gap-3">
                <div className="h-16 bg-white/10 rounded-xl animate-pulse" />
                <div className="h-16 bg-white/10 rounded-xl animate-pulse" />
                <div className="h-16 bg-white/10 rounded-xl animate-pulse" />
              </div>
            </div>
          ) : !data?.code ? (
            /* Generate Code */
            <div className="text-center py-4">
              <p className="text-white/50 text-sm mb-4">Generate your unique referral code to start earning.</p>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleGenerate}
                disabled={generating}
                className="px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
              >
                {generating ? 'Generating...' : '🔗 Generate My Referral Code'}
              </motion.button>
            </div>
          ) : (
            /* Code & Link Display */
            <div className="space-y-4">
              {/* Code */}
              <div>
                <label className="text-white/30 text-[11px] font-semibold uppercase tracking-widest">Your Code</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 bg-black/30 rounded-xl px-4 py-3 font-mono text-banana font-bold text-sm sm:text-base tracking-wider">
                    {data.code}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => copyToClipboard(data.code!, 'code')}
                    className="px-4 py-3 bg-banana/20 hover:bg-banana/30 text-banana rounded-xl text-sm font-bold transition-colors flex-shrink-0"
                  >
                    {copied === 'code' ? '✅' : '📋'}
                  </motion.button>
                </div>
              </div>

              {/* Link */}
              <div>
                <label className="text-white/30 text-[11px] font-semibold uppercase tracking-widest">Your Link</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 bg-black/30 rounded-xl px-4 py-3 text-white/60 text-xs sm:text-sm truncate font-mono">
                    {data.link}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => copyToClipboard(data.link!, 'link')}
                    className="px-4 py-3 bg-banana/20 hover:bg-banana/30 text-banana rounded-xl text-sm font-bold transition-colors flex-shrink-0"
                  >
                    {copied === 'link' ? '✅' : '📋'}
                  </motion.button>
                </div>
              </div>

              {/* Share Buttons */}
              <div className="flex gap-2 pt-2">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={shareTwitter}
                  className="flex-1 py-2.5 bg-[#1DA1F2]/10 hover:bg-[#1DA1F2]/20 border border-[#1DA1F2]/20 text-[#1DA1F2] rounded-xl text-xs font-bold transition-colors"
                >
                  𝕏 Share on Twitter
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={shareDiscord}
                  className="flex-1 py-2.5 bg-[#5865F2]/10 hover:bg-[#5865F2]/20 border border-[#5865F2]/20 text-[#5865F2] rounded-xl text-xs font-bold transition-colors"
                >
                  🎮 Copy for Discord
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    if (navigator.share && data.link) {
                      navigator.share({ title: 'Join BBB4', text: `Join me on Banana Best Ball! 🍌`, url: data.link }).catch(() => {});
                    } else if (data.link) {
                      copyToClipboard(data.link, 'link');
                    }
                  }}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 rounded-xl text-xs font-bold transition-colors"
                >
                  📤 Share
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Stats Grid */}
        {data?.code && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-3 gap-3 mb-6"
          >
            {[
              { label: 'Link Clicks', value: data.clicks, emoji: '👆' },
              { label: 'Signups', value: data.signups, emoji: '👋' },
              { label: 'Passes Earned', value: data.bonusesEarned, emoji: '🎟️' },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                custom={i}
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 sm:p-4 text-center"
              >
                <span className="text-lg">{s.emoji}</span>
                <p className="text-white font-bold text-xl mt-1 tabular-nums">{s.value}</p>
                <p className="text-white/30 text-[10px] uppercase tracking-wider">{s.label}</p>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Reward Tiers */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 sm:p-5 mb-6"
        >
          <h3 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-3">Reward Tiers</h3>
          <div className="space-y-2.5">
            {[
              { refs: 1, reward: '1 Free Draft Pass', emoji: '🎟️', unlocked: (data?.signups || 0) >= 1 },
              { refs: 5, reward: '5 Free Draft Passes + Wheel Spin', emoji: '🍌', unlocked: (data?.signups || 0) >= 5 },
              { refs: 10, reward: '10 Free Passes + HOF Entry', emoji: '🏆', unlocked: (data?.signups || 0) >= 10 },
              { refs: 25, reward: '25 Free Passes + Jackpot Entry', emoji: '🎰', unlocked: (data?.signups || 0) >= 25 },
              { refs: 50, reward: '50 Free Passes + VIP Status', emoji: '👑', unlocked: (data?.signups || 0) >= 50 },
            ].map((tier, _i) => (
              <div
                key={tier.refs}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 transition-all ${
                  tier.unlocked ? 'bg-banana/10 border border-banana/20' : 'bg-white/[0.01]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`text-lg ${tier.unlocked ? '' : 'grayscale opacity-40'}`}>{tier.emoji}</span>
                  <div>
                    <p className={`text-sm font-medium ${tier.unlocked ? 'text-white' : 'text-white/40'}`}>
                      {tier.reward}
                    </p>
                    <p className="text-white/20 text-[10px]">{tier.refs} referral{tier.refs > 1 ? 's' : ''}</p>
                  </div>
                </div>
                {tier.unlocked ? (
                  <span className="text-banana text-xs font-bold">✓ Unlocked</span>
                ) : (
                  <span className="text-white/15 text-xs tabular-nums">{data?.signups || 0}/{tier.refs}</span>
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Tab Toggle: My Referrals / Leaderboard */}
        <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 mb-4">
          {(['stats', 'leaderboard'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                tab === t ? 'bg-banana text-black' : 'text-white/40 hover:text-white/60'
              }`}
            >
              {t === 'stats' ? `👥 My Referrals (${data?.referrals.length || 0})` : '🏆 Top Referrers'}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* My Referrals */}
          {tab === 'stats' && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              {!data?.referrals.length ? (
                <div className="text-center py-12">
                  <div className="text-3xl mb-3 opacity-30">👥</div>
                  <p className="text-white/30 text-sm">No referrals yet. Share your link to get started!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.referrals.map((ref, i) => (
                    <motion.div
                      key={ref.userId}
                      custom={i}
                      variants={fadeIn}
                      initial="hidden"
                      animate="visible"
                      className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-banana/20 flex items-center justify-center text-banana text-xs font-bold">
                          {ref.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{ref.username}</p>
                          <p className="text-white/20 text-[10px]">
                            Joined {new Date(ref.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                        ref.bonusCredited ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {ref.bonusCredited ? '✓ Credited' : 'Pending'}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Leaderboard */}
          {tab === 'leaderboard' && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-1.5"
            >
              {MOCK_LEADERBOARD.map((entry, i) => {
                const isTop3 = entry.rank <= 3;
                const medals = ['🥇', '🥈', '🥉'];

                return (
                  <motion.div
                    key={entry.rank}
                    custom={i}
                    variants={fadeIn}
                    initial="hidden"
                    animate="visible"
                    className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                      isTop3 ? 'bg-banana/5 border border-banana/10' : 'bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-6 text-center ${isTop3 ? 'text-lg' : 'text-white/30 text-xs font-bold'}`}>
                        {isTop3 ? medals[entry.rank - 1] : `#${entry.rank}`}
                      </span>
                      <span className={`font-medium text-sm ${isTop3 ? 'text-white' : 'text-white/60'}`}>
                        {entry.username}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-white/70 text-xs font-bold tabular-nums">{entry.referrals}</p>
                        <p className="text-white/20 text-[9px]">referrals</p>
                      </div>
                      <div className="text-right">
                        <p className="text-banana text-xs font-bold tabular-nums">{entry.earned}</p>
                        <p className="text-white/20 text-[9px]">earned</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 text-center"
        >
          <Link
            href="/buy-drafts"
            className="text-white/20 hover:text-white/50 text-xs transition-colors"
          >
            ← Back to Buy Drafts
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
