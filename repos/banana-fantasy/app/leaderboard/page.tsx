'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ───────────────────────────────────────────────────────────────

type LeaderboardTab = 'overall' | 'bbb' | 'jackpot' | 'hof';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar?: string;
  totalPoints: number;
  wins: number;
  draftsPlayed: number;
  weeklyChange: number; // positive = up, negative = down
  isYou?: boolean;
}

interface Mover {
  username: string;
  change: number;
  newRank: number;
}

// ─── Mock Data ───────────────────────────────────────────────────────────

const NAMES = [
  'CryptoKing', 'DraftGod', 'BananaFan', 'NFLWhiz', 'PickMaster',
  'GridIron', 'TD_Hunter', 'WaiverWire', 'SleepKing', 'RookieRush',
  'SnakeKing', 'ByeWeekHero', 'PPR_Lord', 'BoomBust', 'TradeShark',
  'Waiver_Wire', 'RB1SZN', 'StackAttack', 'NarrowEnd', 'CeilingChaser',
  'FloorGang', 'ValuePick', 'ZeroRB', 'AnchorArm', 'GarbageTime',
  'RedZoneKing', 'YardsAfter', 'TargetHog', 'SnapCount', 'BreakoutStar',
  'HandcuffKing', 'DepthChart', 'ContrarianPick', 'SmashSpot', 'ChalkPlay',
  'FadeCandidate', 'CorrelationPlay', 'RunItBack', 'TourneyGrinder', 'CashLineKing',
];

function generateEntries(tab: LeaderboardTab, _yourWallet: string): LeaderboardEntry[] {
  const seed = tab === 'overall' ? 1 : tab === 'bbb' ? 2 : tab === 'jackpot' ? 3 : 4;
  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < 40; i++) {
    const points = Math.max(0, 2500 - i * 55 + ((seed * 17 + i * 31) % 40) - 20);
    const wins = Math.max(0, 12 - Math.floor(i / 3) + ((seed + i) % 3));
    const drafts = 15 + ((seed * 7 + i * 13) % 10);
    const change = ((seed * 11 + i * 23) % 11) - 5;

    entries.push({
      rank: i + 1,
      userId: `user-${i}`,
      username: NAMES[i % NAMES.length] + (i >= NAMES.length ? `${Math.floor(i / NAMES.length)}` : ''),
      totalPoints: points,
      wins,
      draftsPlayed: drafts,
      weeklyChange: change,
      isYou: i === 7, // mock: user is rank 8
    });
  }

  return entries;
}

function getMovers(entries: LeaderboardEntry[]): { risers: Mover[]; fallers: Mover[] } {
  const sorted = [...entries].sort((a, b) => b.weeklyChange - a.weeklyChange);
  const risers = sorted.filter(e => e.weeklyChange > 0).slice(0, 5).map(e => ({
    username: e.username, change: e.weeklyChange, newRank: e.rank,
  }));
  const fallers = sorted.filter(e => e.weeklyChange < 0).slice(-5).reverse().map(e => ({
    username: e.username, change: e.weeklyChange, newRank: e.rank,
  }));
  return { risers, fallers };
}

// ─── Config ──────────────────────────────────────────────────────────────

const TABS: { key: LeaderboardTab; label: string; emoji: string; color: string; prizePool: number }[] = [
  { key: 'overall', label: 'Overall', emoji: '🏆', color: '#F3E216', prizePool: 250000 },
  { key: 'bbb', label: 'BBB Pro', emoji: '⚡', color: '#a855f7', prizePool: 200000 },
  { key: 'jackpot', label: 'Jackpot', emoji: '🔥', color: '#ef4444', prizePool: 50000 },
  { key: 'hof', label: 'Hall of Fame', emoji: '🏆', color: '#d4af37', prizePool: 25000 },
];

const MEDALS = ['🥇', '🥈', '🥉'];
const PODIUM_HEIGHTS = ['h-28', 'h-20', 'h-16'];
const PODIUM_BG = [
  'from-yellow-500/20 to-yellow-700/10 border-yellow-500/30',
  'from-gray-400/20 to-gray-600/10 border-gray-400/30',
  'from-orange-600/20 to-orange-800/10 border-orange-600/30',
];

// ─── Animations ──────────────────────────────────────────────────────────

const listItem = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.025, duration: 0.25, ease: 'easeOut' as const },
  }),
};

// ─── Page ────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { user } = useAuth();
  const wallet = user?.walletAddress || '';

  const [tab, setTab] = useState<LeaderboardTab>('overall');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const perPage = 20;

  const tabConfig = TABS.find(t => t.key === tab)!;
  const allEntries = useMemo(() => generateEntries(tab, wallet), [tab, wallet]);
  const movers = useMemo(() => getMovers(allEntries), [allEntries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allEntries;
    const q = search.toLowerCase();
    return allEntries.filter(e => e.username.toLowerCase().includes(q));
  }, [allEntries, search]);

  const paginated = useMemo(() => {
    return filtered.slice(page * perPage, (page + 1) * perPage);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const top3 = allEntries.slice(0, 3);
  const yourEntry = allEntries.find(e => e.isYou);

  // Prize pool progress (mock: 65% filled)
  const prizeProgress = 65;

  const handleTabChange = useCallback((newTab: LeaderboardTab) => {
    setTab(newTab);
    setPage(0);
    setSearch('');
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-6 sm:py-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
          <h1 className="text-white text-2xl sm:text-3xl font-bold">Season Leaderboard</h1>
          <p className="text-white/40 text-sm mt-1">BBB4 — Best Ball Banana Season 4</p>
        </motion.div>

        {/* Prize Pool Progress */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/50 text-xs font-medium">Prize Pool</span>
            <span className="text-banana font-bold text-sm">${(tabConfig.prizePool).toLocaleString()}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: tabConfig.color }}
              initial={{ width: 0 }}
              animate={{ width: `${prizeProgress}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' as const }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-white/20 text-[10px]">{prizeProgress}% filled</span>
            <span className="text-white/20 text-[10px]">{Math.round(tabConfig.prizePool * prizeProgress / 100).toLocaleString()} / {tabConfig.prizePool.toLocaleString()}</span>
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex gap-1 bg-white/[0.03] rounded-xl p-1 mb-6"
        >
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                tab === t.key ? 'bg-banana text-black' : 'text-white/40 hover:text-white/60'
              }`}
            >
              <span className="hidden sm:inline">{t.emoji} </span>{t.label}
            </button>
          ))}
        </motion.div>

        {/* Top 3 Podium */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-end justify-center gap-3 mb-8"
        >
          {/* Display order: 2nd, 1st, 3rd */}
          {[1, 0, 2].map((podiumIdx) => {
            const entry = top3[podiumIdx];
            if (!entry) return null;
            const isFirst = podiumIdx === 0;

            return (
              <motion.div
                key={entry.userId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + podiumIdx * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
                className={`flex flex-col items-center ${isFirst ? 'order-2' : podiumIdx === 1 ? 'order-1' : 'order-3'}`}
              >
                {/* Medal + Name */}
                <span className={`text-2xl ${isFirst ? 'text-3xl' : ''} mb-1`}>{MEDALS[podiumIdx]}</span>
                <div className={`w-10 h-10 ${isFirst ? 'w-14 h-14' : ''} rounded-full bg-white/10 border-2 flex items-center justify-center text-sm font-bold text-white/70 mb-1`}
                  style={{ borderColor: `${PODIUM_BG[podiumIdx].includes('yellow') ? '#eab308' : podiumIdx === 1 ? '#9ca3af' : '#ea580c'}40` }}
                >
                  {entry.username.charAt(0)}
                </div>
                <p className={`text-white font-semibold ${isFirst ? 'text-sm' : 'text-xs'} text-center max-w-[80px] truncate`}>
                  {entry.username}
                </p>
                <p className="text-banana text-xs font-bold tabular-nums mt-0.5">{entry.totalPoints.toLocaleString()} pts</p>

                {/* Podium bar */}
                <div className={`w-20 ${isFirst ? 'w-24' : ''} ${PODIUM_HEIGHTS[podiumIdx]} mt-2 rounded-t-lg bg-gradient-to-t ${PODIUM_BG[podiumIdx]} border border-b-0 flex items-center justify-center`}>
                  <span className="text-white/40 text-xs font-bold">#{entry.rank}</span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Your Rank Highlight */}
        {yourEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="bg-banana/10 border border-banana/20 rounded-xl p-4 mb-5 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-banana/20 border border-banana/30 flex items-center justify-center text-banana font-bold text-sm">
                #{yourEntry.rank}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold text-sm">{yourEntry.username}</p>
                  <span className="bg-banana text-black text-[9px] font-bold px-1.5 py-0.5 rounded">YOU</span>
                </div>
                <p className="text-white/40 text-xs">{yourEntry.totalPoints.toLocaleString()} pts · {yourEntry.wins} wins · {yourEntry.draftsPlayed} drafts</p>
              </div>
            </div>
            <div className={`text-xs font-bold ${yourEntry.weeklyChange > 0 ? 'text-green-400' : yourEntry.weeklyChange < 0 ? 'text-red-400' : 'text-white/20'}`}>
              {yourEntry.weeklyChange > 0 ? `▲ ${yourEntry.weeklyChange}` : yourEntry.weeklyChange < 0 ? `▼ ${Math.abs(yourEntry.weeklyChange)}` : '—'}
            </div>
          </motion.div>
        )}

        {/* Weekly Movers */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-3 mb-6"
        >
          {/* Risers */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
            <h3 className="text-green-400 text-[10px] font-bold uppercase tracking-widest mb-2">🔥 Biggest Risers</h3>
            <div className="space-y-1.5">
              {movers.risers.map(m => (
                <div key={m.username} className="flex items-center justify-between">
                  <span className="text-white/60 text-xs truncate max-w-[100px]">{m.username}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/20 text-[10px]">#{m.newRank}</span>
                    <span className="text-green-400 text-[10px] font-bold tabular-nums">▲{m.change}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Fallers */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
            <h3 className="text-red-400 text-[10px] font-bold uppercase tracking-widest mb-2">📉 Biggest Fallers</h3>
            <div className="space-y-1.5">
              {movers.fallers.map(m => (
                <div key={m.username} className="flex items-center justify-between">
                  <span className="text-white/60 text-xs truncate max-w-[100px]">{m.username}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/20 text-[10px]">#{m.newRank}</span>
                    <span className="text-red-400 text-[10px] font-bold tabular-nums">▼{Math.abs(m.change)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Search */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mb-4">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search players..."
            className="w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-banana/40 focus:border-banana/30 transition-all"
          />
        </motion.div>

        {/* Leaderboard Table */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden mb-4">
          {/* Header row */}
          <div className="grid grid-cols-[40px_1fr_80px_50px_50px_50px] sm:grid-cols-[50px_1fr_100px_70px_70px_60px] px-4 py-2.5 border-b border-white/[0.06] text-[10px] text-white/30 font-semibold uppercase tracking-wider">
            <span>#</span>
            <span>Player</span>
            <span className="text-right">Points</span>
            <span className="text-right">Wins</span>
            <span className="text-right hidden sm:block">Drafts</span>
            <span className="text-right">Δ</span>
          </div>

          {/* Rows */}
          <AnimatePresence mode="popLayout">
            {paginated.length === 0 ? (
              <div className="py-12 text-center">
                <span className="text-3xl opacity-20">🔍</span>
                <p className="text-white/30 text-xs mt-2">No players found</p>
              </div>
            ) : (
              paginated.map((entry, i) => (
                <motion.div
                  key={entry.userId}
                  custom={i}
                  variants={listItem}
                  initial="hidden"
                  animate="visible"
                  layout
                  className={`grid grid-cols-[40px_1fr_80px_50px_50px_50px] sm:grid-cols-[50px_1fr_100px_70px_70px_60px] px-4 py-3 items-center border-b border-white/[0.03] last:border-0 transition-colors ${
                    entry.isYou ? 'bg-banana/[0.06]' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Rank */}
                  <span className={`text-xs font-bold tabular-nums ${entry.rank <= 3 ? 'text-banana' : 'text-white/30'}`}>
                    {entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}
                  </span>

                  {/* Player */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-[10px] font-bold flex-shrink-0">
                      {entry.username.charAt(0)}
                    </div>
                    <span className={`text-sm font-medium truncate ${entry.isYou ? 'text-banana' : 'text-white/80'}`}>
                      {entry.username}
                    </span>
                    {entry.isYou && (
                      <span className="bg-banana text-black text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0">YOU</span>
                    )}
                  </div>

                  {/* Points */}
                  <span className="text-right text-sm text-white font-semibold tabular-nums">
                    {entry.totalPoints.toLocaleString()}
                  </span>

                  {/* Wins */}
                  <span className="text-right text-xs text-white/50 tabular-nums">{entry.wins}</span>

                  {/* Drafts */}
                  <span className="text-right text-xs text-white/30 tabular-nums hidden sm:block">{entry.draftsPlayed}</span>

                  {/* Weekly Change */}
                  <span className={`text-right text-[11px] font-bold tabular-nums ${
                    entry.weeklyChange > 0 ? 'text-green-400' : entry.weeklyChange < 0 ? 'text-red-400' : 'text-white/15'
                  }`}>
                    {entry.weeklyChange > 0 ? `▲${entry.weeklyChange}` : entry.weeklyChange < 0 ? `▼${Math.abs(entry.weeklyChange)}` : '—'}
                  </span>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2"
          >
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 bg-white/5 text-white/40 text-xs font-medium rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ← Prev
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-all ${
                    page === i ? 'bg-banana text-black' : 'bg-white/5 text-white/30 hover:bg-white/10'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-white/5 text-white/40 text-xs font-medium rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next →
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
