'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ───────────────────────────────────────────────────────────────

type DraftType = 'bbb' | 'jackpot' | 'hof' | 'jackhof';
type LobbyStatus = 'open' | 'filling' | 'starting' | 'full';

interface Lobby {
  id: string;
  name: string;
  draftType: DraftType;
  seats: number;
  maxSeats: number;
  entryFee: number;
  prizePool: number;
  speed: 'fast' | 'slow';
  status: LobbyStatus;
  startsAt?: number; // timestamp for countdown
  players: string[]; // display names of seated players
}

interface UserDraft {
  id: string;
  name: string;
  draftType: DraftType;
  status: 'waiting' | 'drafting';
  seats: number;
  maxSeats: number;
  yourPick?: number;
  totalPicks?: number;
  startsAt?: number;
}

// ─── Config ──────────────────────────────────────────────────────────────

const DRAFT_TYPE_CONFIG: Record<DraftType, { label: string; emoji: string; color: string; bgGrad: string; borderColor: string; odds: string; description: string }> = {
  bbb: {
    label: 'BBB Pro',
    emoji: '⚡',
    color: '#a855f7',
    bgGrad: 'from-purple-600/15 to-purple-900/5',
    borderColor: 'border-purple-500/30',
    odds: '94%',
    description: 'Standard best-ball draft. Compete for weekly + season prizes.',
  },
  jackpot: {
    label: 'Jackpot',
    emoji: '🔥',
    color: '#ef4444',
    bgGrad: 'from-red-600/15 to-red-900/5',
    borderColor: 'border-red-500/30',
    odds: '1%',
    description: 'Skip to the finals. Win the grand prize pool outright.',
  },
  hof: {
    label: 'Hall of Fame',
    emoji: '🏆',
    color: '#d4af37',
    bgGrad: 'from-yellow-600/15 to-yellow-900/5',
    borderColor: 'border-yellow-500/30',
    odds: '5%',
    description: 'Bonus prize pool. Top performers enter the Hall of Fame.',
  },
  jackhof: {
    label: 'JackHOF',
    emoji: '👑',
    color: '#ef6c37',
    bgGrad: 'from-red-600/15 to-yellow-900/5',
    borderColor: 'border-red-500/30',
    odds: '1/800',
    description: 'Jackpot + HOF on one draft. Skip to the finals AND chase the bonus pool.',
  },
};

// ─── Mock Data ───────────────────────────────────────────────────────────

function generateMockLobbies(): Lobby[] {
  const lobbies: Lobby[] = [];
  const names = ['Banana Blitz', 'Monkey Mayhem', 'Peel Party', 'Golden Split', 'Tropical Storm', 'Jungle Draft', 'Ripe Rivalry', 'Bunch Bash'];
  const playerNames = ['CryptoKing', 'DraftGod', 'BananaFan', 'NFLWhiz', 'PickMaster', 'GridIron', 'TD_Hunter', 'WaiverWire', 'SleepKing', 'RookieRush'];

  let id = 1;
  for (const type of ['bbb', 'bbb', 'bbb', 'bbb', 'bbb', 'jackpot', 'hof', 'hof', 'bbb', 'bbb'] as DraftType[]) {
    const maxSeats = 10;
    const seats = Math.floor(Math.random() * 10);
    const status: LobbyStatus = seats >= maxSeats ? 'full' : seats >= 7 ? 'filling' : 'open';
    const seatedPlayers = playerNames.slice(0, seats).map((n, i) => `${n}${i > 0 ? i : ''}`);

    lobbies.push({
      id: `lobby-${id}`,
      name: `${names[(id - 1) % names.length]} #${100 + id}`,
      draftType: type,
      seats,
      maxSeats,
      entryFee: type === 'jackpot' ? 25 : type === 'hof' ? 25 : 25,
      prizePool: type === 'jackpot' ? 50000 : type === 'hof' ? 5000 : 225,
      speed: id % 3 === 0 ? 'slow' : 'fast',
      status,
      startsAt: seats >= 8 ? Date.now() + (30 + Math.random() * 90) * 1000 : undefined,
      players: seatedPlayers,
    });
    id++;
  }

  return lobbies;
}

function generateMockUserDrafts(): UserDraft[] {
  return [
    {
      id: 'my-draft-1',
      name: 'Banana Blitz #98',
      draftType: 'bbb',
      status: 'waiting',
      seats: 7,
      maxSeats: 10,
      startsAt: Date.now() + 120000,
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPrize(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

// ─── Animation Variants ──────────────────────────────────────────────────

const listItem = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: 'easeOut' as const },
  }),
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

const filterPill = {
  active: { backgroundColor: '#F3E216', color: '#000' },
  inactive: { backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' },
};

// ─── Components ──────────────────────────────────────────────────────────

function SeatIndicator({ seats, maxSeats }: { seats: number; maxSeats: number }) {
  const pct = (seats / maxSeats) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: maxSeats }).map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              i < seats
                ? pct >= 80 ? 'bg-red-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-green-400'
                : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      <span className="text-white/50 text-xs tabular-nums">{seats}/{maxSeats}</span>
    </div>
  );
}

function CountdownBadge({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(targetMs - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(targetMs - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  if (remaining <= 0) return <span className="text-red-400 text-xs font-bold animate-pulse">Starting...</span>;

  return (
    <motion.span
      animate={remaining < 30000 ? { scale: [1, 1.05, 1] } : {}}
      transition={{ repeat: Infinity, duration: 1 }}
      className={`text-xs font-mono font-bold tabular-nums ${remaining < 30000 ? 'text-red-400' : 'text-banana'}`}
    >
      ⏱ {formatCountdown(remaining)}
    </motion.span>
  );
}

function LobbyCard({ lobby, index, onJoin }: { lobby: Lobby; index: number; onJoin: (id: string) => void }) {
  const config = DRAFT_TYPE_CONFIG[lobby.draftType];
  const isFilling = lobby.seats >= 7;
  const isFull = lobby.seats >= lobby.maxSeats;

  return (
    <motion.div
      custom={index}
      variants={listItem}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
      className={`rounded-xl bg-gradient-to-br ${config.bgGrad} border ${config.borderColor} overflow-hidden`}
    >
      <div className="p-4 sm:p-5">
        {/* Top row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{config.emoji}</span>
            <div>
              <h3 className="text-white font-semibold text-sm sm:text-base leading-tight">{lobby.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ color: config.color, backgroundColor: `${config.color}20` }}>
                  {config.label}
                </span>
                <span className="text-white/25 text-[11px]">{lobby.speed === 'fast' ? '⚡ Fast' : '🐢 Slow'}</span>
              </div>
            </div>
          </div>

          {/* Prize pool */}
          <div className="text-right">
            <p className="text-white font-bold text-sm">{formatPrize(lobby.prizePool)}</p>
            <p className="text-white/30 text-[11px]">Prize Pool</p>
          </div>
        </div>

        {/* Middle: seats + countdown */}
        <div className="flex items-center justify-between mb-3">
          <SeatIndicator seats={lobby.seats} maxSeats={lobby.maxSeats} />
          {lobby.startsAt && <CountdownBadge targetMs={lobby.startsAt} />}
          {!lobby.startsAt && isFilling && (
            <span className="text-yellow-400/70 text-xs font-medium">Almost full</span>
          )}
        </div>

        {/* Bottom: entry fee + join */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-xs">${lobby.entryFee} entry</span>
            {lobby.players.length > 0 && (
              <div className="flex -space-x-1.5">
                {lobby.players.slice(0, 4).map((name, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[8px] text-white/60 font-bold"
                    title={name}
                  >
                    {name.charAt(0)}
                  </div>
                ))}
                {lobby.players.length > 4 && (
                  <div className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[8px] text-white/40">
                    +{lobby.players.length - 4}
                  </div>
                )}
              </div>
            )}
          </div>

          <motion.button
            whileHover={!isFull ? { scale: 1.05 } : {}}
            whileTap={!isFull ? { scale: 0.95 } : {}}
            onClick={() => !isFull && onJoin(lobby.id)}
            disabled={isFull}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              isFull
                ? 'bg-white/5 text-white/20 cursor-not-allowed'
                : isFilling
                  ? 'bg-red-500 text-white hover:bg-red-400 shadow-lg shadow-red-500/20'
                  : 'bg-banana text-black hover:brightness-110'
            }`}
          >
            {isFull ? 'Full' : isFilling ? 'Join Now!' : 'Join'}
          </motion.button>
        </div>
      </div>

      {/* Filling urgency bar */}
      {isFilling && !isFull && (
        <div className="h-0.5 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-yellow-500 to-red-500"
            initial={{ width: 0 }}
            animate={{ width: `${(lobby.seats / lobby.maxSeats) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
          />
        </div>
      )}
    </motion.div>
  );
}

function UserDraftCard({ draft }: { draft: UserDraft }) {
  const config = DRAFT_TYPE_CONFIG[draft.draftType];

  return (
    <Link
      href={draft.status === 'drafting' ? `/draft-room?id=${draft.id}` : `/draft-room?id=${draft.id}&name=${encodeURIComponent(draft.name)}`}
      className="block"
    >
      <motion.div
        whileHover={{ scale: 1.01 }}
        className="rounded-xl bg-banana/10 border border-banana/20 p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-banana/20 flex items-center justify-center text-lg">
            {config.emoji}
          </div>
          <div>
            <h4 className="text-white font-semibold text-sm">{draft.name}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <SeatIndicator seats={draft.seats} maxSeats={draft.maxSeats} />
              {draft.startsAt && <CountdownBadge targetMs={draft.startsAt} />}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {draft.status === 'drafting' ? (
            <span className="px-3 py-1.5 bg-green-500/20 text-green-400 text-xs font-bold rounded-lg animate-pulse">
              LIVE
            </span>
          ) : (
            <span className="px-3 py-1.5 bg-banana/20 text-banana text-xs font-bold rounded-lg">
              Waiting
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </motion.div>
    </Link>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function DraftQueuePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | DraftType>('all');
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [userDrafts] = useState<UserDraft[]>(generateMockUserDrafts);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Generate + simulate lobby fill
  useEffect(() => {
    setLobbies(generateMockLobbies());

    // Simulate real-time updates: slowly fill lobbies
    const interval = setInterval(() => {
      setLobbies(prev => prev.map(l => {
        if (l.seats >= l.maxSeats) return l;
        // ~10% chance a seat fills each tick
        if (Math.random() > 0.9) {
          const newSeats = l.seats + 1;
          return {
            ...l,
            seats: newSeats,
            status: newSeats >= l.maxSeats ? 'full' as LobbyStatus : newSeats >= 7 ? 'filling' as LobbyStatus : l.status,
            startsAt: newSeats >= 8 && !l.startsAt ? Date.now() + 60000 : l.startsAt,
            players: [...l.players, `Player${newSeats}`],
          };
        }
        return l;
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const filteredLobbies = useMemo(() => {
    if (filter === 'all') return lobbies;
    return lobbies.filter(l => l.draftType === filter);
  }, [lobbies, filter]);

  const handleJoin = useCallback(async (lobbyId: string) => {
    setJoiningId(lobbyId);
    // Simulate join delay
    await new Promise(r => setTimeout(r, 800));
    const lobby = lobbies.find(l => l.id === lobbyId);
    if (lobby) {
      router.push(`/draft-room?id=${lobbyId}&name=${encodeURIComponent(lobby.name)}&speed=${lobby.speed}`);
    }
    setJoiningId(null);
  }, [lobbies, router]);

  const draftPassCount = (user?.draftPasses || 0) + (user?.freeDrafts || 0);
  const filters: { key: 'all' | DraftType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'bbb', label: '⚡ BBB' },
    { key: 'jackpot', label: '🔥 Jackpot' },
    { key: 'hof', label: '🏆 HOF' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-6 sm:py-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-white text-2xl sm:text-3xl font-bold">Draft Lobbies</h1>
              <p className="text-white/40 text-sm mt-1">Find a lobby and draft your team</p>
            </div>
            <div className="text-right">
              {draftPassCount > 0 ? (
                <div className="bg-banana/10 border border-banana/20 rounded-xl px-3 py-2">
                  <p className="text-banana text-lg font-bold tabular-nums">{draftPassCount}</p>
                  <p className="text-banana/60 text-[10px] uppercase tracking-wider font-medium">
                    {draftPassCount === 1 ? 'Pass' : 'Passes'}
                  </p>
                </div>
              ) : (
                <Link
                  href="/buy-drafts"
                  className="px-4 py-2 bg-banana text-black text-sm font-bold rounded-xl hover:brightness-110 transition-all"
                >
                  Buy Passes
                </Link>
              )}
            </div>
          </div>
        </motion.div>

        {/* Your Upcoming Drafts */}
        {userDrafts.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <h2 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-3">
              Your Drafts
            </h2>
            <div className="space-y-2">
              {userDrafts.map(d => (
                <UserDraftCard key={d.id} draft={d} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Filter Pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-hide"
        >
          {filters.map(f => (
            <motion.button
              key={f.key}
              onClick={() => setFilter(f.key)}
              animate={filter === f.key ? 'active' : 'inactive'}
              variants={filterPill}
              transition={{ duration: 0.2 }}
              className="px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0"
            >
              {f.label}
            </motion.button>
          ))}

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 ml-auto text-white/20 text-[11px] flex-shrink-0">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="w-1.5 h-1.5 rounded-full bg-green-400"
            />
            Live
          </div>
        </motion.div>

        {/* Lobby List */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredLobbies.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <div className="text-4xl mb-3">🍌</div>
                <p className="text-white/40 text-sm">No lobbies match this filter</p>
              </motion.div>
            ) : (
              filteredLobbies.map((lobby, i) => (
                <LobbyCard
                  key={lobby.id}
                  lobby={{ ...lobby, status: joiningId === lobby.id ? 'full' : lobby.status }}
                  index={i}
                  onJoin={handleJoin}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Stats footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 grid grid-cols-3 gap-3"
        >
          {[
            { label: 'Open Lobbies', value: lobbies.filter(l => l.status !== 'full').length },
            { label: 'Players Online', value: lobbies.reduce((s, l) => s + l.seats, 0) },
            { label: 'Drafts Today', value: 147 },
          ].map(stat => (
            <div key={stat.label} className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-3 text-center">
              <p className="text-white font-bold text-lg tabular-nums">{stat.value}</p>
              <p className="text-white/30 text-[10px] uppercase tracking-wider">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Bottom CTA */}
        {draftPassCount === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-6 text-center"
          >
            <p className="text-white/30 text-xs mb-3">Need a draft pass to join a lobby</p>
            <Link
              href="/buy-drafts"
              className="inline-block px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm"
            >
              🎟️ Buy Draft Pass — $25
            </Link>
          </motion.div>
        )}
      </div>
    </div>
  );
}
