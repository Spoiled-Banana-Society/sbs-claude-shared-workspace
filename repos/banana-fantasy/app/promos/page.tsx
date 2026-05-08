'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePromos } from '@/hooks/usePromos';
import { PromoModal } from '@/components/modals/PromoModal';
import { reservePromoDraftType } from '@/lib/promoDraftType';
import { logger } from '@/lib/logger';
import type { Promo, PromoType } from '@/types';

// ─── Type → visual treatment ─────────────────────────────────────────
// Each promo type gets an accent color, gradient, and emoji so the
// grid reads at a glance (no two cards look identical).
interface TypeStyle {
  accent: string;
  glow: string;
  gradient: string;
  emoji: string;
  label: string;
}

const TYPE_STYLES: Record<PromoType, TypeStyle> = {
  'daily-drafts':       { accent: '#fbbf24', glow: 'rgba(251,191,36,0.35)',  gradient: 'from-yellow-400/20 via-amber-500/10 to-transparent',     emoji: '🔁', label: 'Daily' },
  'pick-10':            { accent: '#22c55e', glow: 'rgba(34,197,94,0.35)',   gradient: 'from-emerald-400/20 via-green-500/10 to-transparent',     emoji: '🔟', label: 'Pick' },
  'referral':           { accent: '#3b82f6', glow: 'rgba(59,130,246,0.35)',  gradient: 'from-blue-400/20 via-blue-600/10 to-transparent',         emoji: '🔗', label: 'Referral' },
  'jackpot':            { accent: '#ef4444', glow: 'rgba(239,68,68,0.45)',   gradient: 'from-red-500/25 via-rose-600/10 to-transparent',          emoji: '💰', label: 'Jackpot' },
  'hof':                { accent: '#D4AF37', glow: 'rgba(212,175,55,0.45)',  gradient: 'from-yellow-300/25 via-amber-500/10 to-transparent',      emoji: '🏛️', label: 'HOF' },
  'mint':               { accent: '#a855f7', glow: 'rgba(168,85,247,0.35)',  gradient: 'from-purple-400/20 via-fuchsia-500/10 to-transparent',    emoji: '🪙', label: 'Mint' },
  'new-user':           { accent: '#ec4899', glow: 'rgba(236,72,153,0.35)',  gradient: 'from-pink-400/20 via-rose-500/10 to-transparent',         emoji: '✨', label: 'New' },
  'buy-bonus':          { accent: '#f97316', glow: 'rgba(249,115,22,0.35)',  gradient: 'from-orange-400/20 via-amber-500/10 to-transparent',      emoji: '🎁', label: 'Bonus' },
  'tweet-engagement':   { accent: '#0ea5e9', glow: 'rgba(14,165,233,0.35)',  gradient: 'from-sky-400/20 via-cyan-500/10 to-transparent',          emoji: '𝕏',  label: 'X' },
  'add-to-home-screen': { accent: '#64748b', glow: 'rgba(100,116,139,0.30)', gradient: 'from-slate-400/15 via-slate-600/10 to-transparent',       emoji: '📱', label: 'Install' },
  'spin-share':         { accent: '#8b5cf6', glow: 'rgba(139,92,246,0.35)',  gradient: 'from-violet-400/20 via-purple-500/10 to-transparent',     emoji: '🎡', label: 'Share' },
  'founder-draft':      { accent: '#06b6d4', glow: 'rgba(6,182,212,0.40)',   gradient: 'from-cyan-400/25 via-teal-500/10 to-transparent',         emoji: '👑', label: 'Founder' },
};

const HIDDEN_PROMO_TYPES = new Set<PromoType>(['spin-share', 'add-to-home-screen']);

type FilterKey = 'all' | 'claimable' | 'active' | 'locked';

function formatTimeRemaining(endTime?: string): string {
  if (!endTime) return '';
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return '0:00:00';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function PromosPage() {
  const router = useRouter();
  const { user, updateUser, isLoggedIn, setShowLoginModal, isTwitterVerified, isBB3Holder, newUserPromoClaimed } = useAuth();
  const promosQuery = usePromos({ userId: user?.id });
  const promos = promosQuery.promos;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [claimedLocally, setClaimedLocally] = useState<Set<string>>(new Set());
  const [_tick, setTick] = useState(0);

  // Refresh timer-based UI every second.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync the open modal with promo updates (e.g. after verify or claim).
  useEffect(() => {
    if (!selectedPromo) return;
    const updated = promos.find(p => p.id === selectedPromo.id);
    if (updated && updated !== selectedPromo) setSelectedPromo(updated);
  }, [promos, selectedPromo]);

  const isClaimed = (p: Promo) =>
    claimedLocally.has(p.id) || (p.type === 'new-user' && newUserPromoClaimed);

  const hasVisibleClaim = (p: Promo) => {
    if (!p.claimable || isClaimed(p)) return false;
    if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
    return true;
  };

  const visiblePromos = useMemo(() => {
    return promos
      .filter(p => !(p.type === 'new-user' && isBB3Holder))
      .filter(p => !HIDDEN_PROMO_TYPES.has(p.type));
  }, [promos, isBB3Holder]);

  const filteredPromos = useMemo(() => {
    let result = [...visiblePromos];
    if (filter === 'claimable') {
      result = result.filter(hasVisibleClaim);
    } else if (filter === 'active') {
      result = result.filter(p => !hasVisibleClaim(p) && !isClaimed(p) && (p.progressMax || p.timerEndTime));
    } else if (filter === 'locked') {
      result = result.filter(p =>
        ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) ||
        !isLoggedIn,
      );
    }
    return result.sort((a, b) => {
      const aClaim = hasVisibleClaim(a) ? 1 : 0;
      const bClaim = hasVisibleClaim(b) ? 1 : 0;
      if (aClaim !== bClaim) return bClaim - aClaim;
      const aProgress = a.progressMax ? (a.progressCurrent || 0) / a.progressMax : 0;
      const bProgress = b.progressMax ? (b.progressCurrent || 0) / b.progressMax : 0;
      if (bProgress !== aProgress) return bProgress - aProgress;
      return Number(a.id) - Number(b.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePromos, filter, isTwitterVerified, isLoggedIn, claimedLocally, newUserPromoClaimed]);

  const claimableCount = useMemo(() => visiblePromos.filter(hasVisibleClaim).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePromos, isTwitterVerified, claimedLocally, newUserPromoClaimed]);

  const handleClaim = async (promo: Promo) => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    const count = promo.claimCount || 1;
    if (promo.type === 'jackpot' || promo.type === 'hof') {
      reservePromoDraftType(promo.type, count);
    }
    if (promosQuery.claimPromo) {
      const result = await promosQuery.claimPromo(promo.id);
      if (result instanceof Error) return;
      setClaimedLocally(prev => new Set([...Array.from(prev), promo.id]));
      return;
    }
    setClaimedLocally(prev => new Set([...Array.from(prev), promo.id]));
    if (user) {
      if (promo.type === 'buy-bonus') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + count });
      } else {
        updateUser({ wheelSpins: (user.wheelSpins || 0) + count });
      }
    }
  };

  return (
    <div className="w-full min-h-screen px-4 sm:px-8 lg:px-12 py-8 max-w-6xl mx-auto">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Promos</h1>
        <p className="text-white/40 text-sm">
          {visiblePromos.length} active rewards · click any card for details
        </p>
      </div>

      {/* ── Stat tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatTile label="Claimable" value={claimableCount} accent="#fbbf24" pulse={claimableCount > 0} />
        <StatTile label="Free Spins" value={user?.wheelSpins ?? 0} accent="#a855f7" />
        <StatTile label="Free Drafts" value={user?.freeDrafts ?? 0} accent="#22c55e" />
        <StatTile label="JP Entries" value={(user?.jackpotEntries ?? 0) + (user?.hofEntries ?? 0)} accent="#ef4444" sublabel={`${user?.jackpotEntries ?? 0} JP · ${user?.hofEntries ?? 0} HOF`} />
      </div>

      {/* ── Filter tabs ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {([
          ['all',       'All',       visiblePromos.length],
          ['claimable', 'Claimable', claimableCount],
          ['active',    'In Progress', null],
          ['locked',    'Locked',    null],
        ] as [FilterKey, string, number | null][]).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === key ? 'bg-banana text-black' : 'bg-white/[0.04] text-white/50 hover:text-white/80'
            }`}
          >
            {label}
            {count !== null && (
              <span className={`ml-1.5 ${filter === key ? 'opacity-70' : 'opacity-50'}`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Loading state ──────────────────────────────────────────────── */}
      {promosQuery.isLoading && visiblePromos.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty filter state ─────────────────────────────────────────── */}
      {!promosQuery.isLoading && filteredPromos.length === 0 && visiblePromos.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center">
          <p className="text-white/40 text-sm">No promos in this filter.</p>
          <button onClick={() => setFilter('all')} className="text-banana text-xs mt-2 hover:underline">
            Show all
          </button>
        </div>
      )}

      {/* ── Promo grid ─────────────────────────────────────────────────── */}
      {filteredPromos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPromos.map(promo => (
            <PromoCard
              key={promo.id}
              promo={promo}
              isClaimed={isClaimed(promo)}
              hasVisibleClaim={hasVisibleClaim(promo)}
              onClick={() => setSelectedPromo(promo)}
              onClaim={() => void handleClaim(promo)}
            />
          ))}
        </div>
      )}

      {/* ── Footer hint ────────────────────────────────────────────────── */}
      {filteredPromos.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2 items-center justify-center text-[11px] text-white/30">
          <span>Need draft passes?</span>
          <button onClick={() => router.push('/buy-drafts')} className="text-banana hover:underline">
            Buy more
          </button>
          <span>·</span>
          <button onClick={() => router.push('/banana-wheel')} className="text-banana hover:underline">
            Spin the wheel
          </button>
        </div>
      )}

      {/* ── Detail modal ───────────────────────────────────────────────── */}
      <PromoModal
        isOpen={!!selectedPromo}
        onClose={() => setSelectedPromo(null)}
        promo={selectedPromo}
        onClaim={(p) => {
          logger.debug('Claiming promo:', p.id);
          setSelectedPromo(null);
          void handleClaim(p);
        }}
        isPromoClaimed={selectedPromo ? isClaimed(selectedPromo) : false}
        onVerifyTweet={promosQuery.verifyTweetEngagement}
        onGenerateReferralCode={promosQuery.generateReferralCode}
      />
    </div>
  );
}

// ─── Stat tile (hero) ────────────────────────────────────────────────
function StatTile({ label, value, accent, pulse, sublabel }: {
  label: string;
  value: number | string;
  accent: string;
  pulse?: boolean;
  sublabel?: string;
}) {
  return (
    <div
      className="relative rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 overflow-hidden"
      style={{ boxShadow: pulse ? `0 0 0 1px ${accent}40, 0 0 20px ${accent}30` : undefined }}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
        background: `radial-gradient(circle at top right, ${accent}25 0%, transparent 60%)`,
      }} />
      <p className="relative text-white/40 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="relative text-white font-bold text-2xl tabular-nums" style={{ color: pulse ? accent : '#fff' }}>
        {value}
      </p>
      {sublabel && <p className="relative text-white/30 text-[10px] mt-0.5">{sublabel}</p>}
    </div>
  );
}

// ─── Promo card (grid item) ──────────────────────────────────────────
interface PromoCardProps {
  promo: Promo;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onClick: () => void;
  onClaim: () => void;
}

function PromoCard({ promo, isClaimed, hasVisibleClaim, onClick, onClaim }: PromoCardProps) {
  const style = TYPE_STYLES[promo.type];
  const progressMax = promo.progressMax || 0;
  const progressCurrent = isClaimed ? progressMax : (promo.progressCurrent || 0);
  const progressPercent = progressMax > 0 ? Math.min(100, (progressCurrent / progressMax) * 100) : 0;
  const showProgress = progressMax > 0;
  const timeRemaining = promo.timerEndTime ? formatTimeRemaining(promo.timerEndTime) : '';

  // Status pill: claimable > claimed > active > default
  let statusPill: { label: string; color: string; bg: string; pulse?: boolean } | null = null;
  if (hasVisibleClaim) {
    statusPill = { label: '🔥 Claimable', color: '#000', bg: '#fbbf24', pulse: true };
  } else if (isClaimed && promo.type !== 'daily-drafts' && promo.type !== 'pick-10') {
    // daily-drafts/pick-10 reset constantly so don't mark as "claimed"
    statusPill = { label: '✓ Claimed', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' };
  } else if (showProgress) {
    statusPill = { label: 'Active', color: style.accent, bg: `${style.accent}20` };
  }

  return (
    <button
      onClick={onClick}
      className="relative group w-full text-left rounded-2xl overflow-hidden border border-white/[0.06] bg-[#0d0d12] hover:border-white/20 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        boxShadow: hasVisibleClaim
          ? `0 0 0 1px ${style.accent}55, 0 6px 24px ${style.glow}`
          : undefined,
      }}
    >
      {/* Type-colored gradient background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${style.gradient} pointer-events-none`} />

      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${style.accent}00, ${style.accent}, ${style.accent}00)` }}
      />

      {/* NEW ribbon */}
      {promo.isNew && (
        <span className="absolute top-3 right-3 z-10 inline-block bg-banana text-black text-[10px] font-bold px-2 py-0.5 rounded-md shadow-lg">
          NEW
        </span>
      )}

      <div className="relative p-5 flex flex-col h-full min-h-[14rem]">
        {/* Top row: type label + emoji */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
            style={{ color: style.accent, background: `${style.accent}15` }}
          >
            {style.label}
          </span>
          <span
            className="text-2xl leading-none"
            style={{ filter: `drop-shadow(0 0 8px ${style.glow})` }}
          >
            {style.emoji}
          </span>
        </div>

        {/* Title + description */}
        <h3 className="text-white font-bold text-base sm:text-lg leading-tight mb-1.5">
          {promo.title}
        </h3>
        <p className="text-white/50 text-xs leading-relaxed mb-4 line-clamp-2">
          {promo.description}
        </p>

        {/* Progress bar (if applicable) */}
        {showProgress && (
          <div className="mt-auto mb-3">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-white/60 text-xs font-semibold tabular-nums">
                {progressCurrent}/{progressMax}
              </span>
              {timeRemaining && (
                <span className="text-white/40 text-[10px] font-mono tabular-nums">{timeRemaining}</span>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPercent}%`,
                  background: `linear-gradient(90deg, ${style.accent}, ${style.accent}cc)`,
                  boxShadow: `0 0 8px ${style.glow}`,
                }}
              />
            </div>
          </div>
        )}

        {/* Bottom row: status pill + claim button */}
        <div className={`flex items-center justify-between gap-2 ${showProgress ? '' : 'mt-auto'}`}>
          <div className="flex-1 min-w-0">
            {statusPill && (
              <span
                className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${statusPill.pulse ? 'animate-pulse' : ''}`}
                style={{ color: statusPill.color, background: statusPill.bg }}
              >
                {statusPill.label}
              </span>
            )}
          </div>

          {hasVisibleClaim ? (
            <button
              onClick={(e) => { e.stopPropagation(); onClaim(); }}
              className="shrink-0 px-3.5 py-2 bg-banana text-black text-xs font-black uppercase tracking-wider rounded-full hover:scale-105 active:scale-95 transition-transform"
              style={{ boxShadow: `0 0 0 1px ${style.accent}, 0 4px 16px ${style.glow}` }}
            >
              {promo.claimCount && promo.claimCount > 1 ? `Claim (${promo.claimCount})` : 'Claim'}
            </button>
          ) : (
            <span className="shrink-0 text-white/30 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              Details →
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
