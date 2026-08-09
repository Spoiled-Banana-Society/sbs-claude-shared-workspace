'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePromos } from '@/hooks/usePromos';
import { PromoModal } from '@/components/modals/PromoModal';
import { logger } from '@/lib/logger';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { API_CONFIG } from '@/lib/api/config';
import { SpinExplainer } from '@/components/promos/SpinExplainer';
import { EliminatorBanner } from '@/components/promos/EliminatorBanner';
import { DropCountdown } from '@/components/promos/DropCountdown';
import { ActivityHistory } from '@/components/profile/ActivityHistory';
import { deriveChaseState } from '@/lib/chasePromo';
import type { Promo, PromoType } from '@/types';

// ─── Type → visual treatment ─────────────────────────────────────────
// Restrained Apple-style treatment: a single accent color per type used
// only as a small dot in the corner of the card. No gradients, no
// emoji glows, no pulsing. The card itself is a clean glass panel.
interface TypeStyle {
  accent: string;
  label: string;
}

const TYPE_STYLES: Record<PromoType, TypeStyle> = {
  'daily-drafts':       { accent: '#fbbf24', label: 'Daily' },
  'pick-10':            { accent: '#22c55e', label: 'Pick 10' },
  'referral':           { accent: '#3b82f6', label: 'Referral' },
  'jackpot':            { accent: '#ef4444', label: 'Jackpot' },
  'hof':                { accent: '#D4AF37', label: 'HOF' },
  'mint':               { accent: '#a855f7', label: 'Buy' },
  'new-user':           { accent: '#ec4899', label: 'New User' },
  'buy-bonus':          { accent: '#22c55e', label: 'Kickoff' },
  'tweet-engagement':   { accent: '#0ea5e9', label: 'X' },
  'spin-share':         { accent: '#8b5cf6', label: 'Share' },
  'founder-draft':      { accent: '#06b6d4', label: 'Founder' },
  'first-purchase':     { accent: '#fbbf24', label: 'First Buy' },
  'pick-chase':         { accent: '#f97316', label: 'Match' },
  // JackHOF orange — the dual-tier accent, same as the wheel's JackHOF wedge.
  'banana-draw':        { accent: '#ef6c37', label: 'Bananas' },
  // Same JackHOF orange: the Eliminator gives out the same seat, so it reads as
  // the successor to the Banana Draw rather than an unrelated promo.
  'eliminator':         { accent: '#ef6c37', label: 'Eliminator' },
  // Deep night-blue — THE DROP is the 8pm promo, and the colour keeps it
  // visually distinct from the JackHOF-orange promos that came before it.
  'drop':               { accent: '#6366f1', label: 'The Drop' },
};

type FilterKey = 'all' | 'claimable' | 'active' | 'locked' | 'activity';

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
  const searchParams = useSearchParams();
  const promoQueryId = searchParams?.get('promo') ?? null;
  // Jackpot draw replay deep-link (noti → ?promo=4&draw=<draftId>).
  const drawQueryId = searchParams?.get('draw') ?? null;
  const autoOpenedRef = useRef<string | null>(null);

  const { user, updateUser, isLoggedIn, setShowLoginModal, isTwitterVerified, isBB3Holder, newUserPromoClaimed, isBalanceLoaded } = useAuth();
  const promosQuery = usePromos({ userId: user?.id });
  // ⛔ The client-side Pick-slot LADDER was REMOVED 2026-07-26. It derived
  // "slots 6/9/10 are live" from the SSE's legacy per-100 batch counters
  // (jackpotRemaining/hofRemaining), which know nothing about the rolling-lane
  // era that RETIRED the ladder on 2026-07-20. Result: the moment a batch's
  // 5th HOF landed (draft 297), the card advertised "Pick 6 9 10 → FREE SPIN"
  // while the SERVER still only ever credited slot 10 — promising spins that
  // could never be paid. Pick 10 is the only winning slot; the server's
  // getPick10DisplayTier already puts the right copy on promo.title, so the
  // card must just render what the server sends.
  const promos = promosQuery.promos;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [claimedLocally, setClaimedLocally] = useState<Set<string>>(new Set());
  const [isClaimingAll, setIsClaimingAll] = useState(false);
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

  // Auto-open a promo modal when arriving with ?promo={id} (e.g. from a
  // "Ready to Claim" notification). Tracked per-id so closing the modal
  // doesn't re-open it on the next promos refresh.
  useEffect(() => {
    if (!promoQueryId || promos.length === 0) return;
    if (autoOpenedRef.current === promoQueryId) return;
    const match = promos.find(p => p.id === promoQueryId);
    if (!match) return;
    autoOpenedRef.current = promoQueryId;
    setSelectedPromo(match);
  }, [promoQueryId, promos]);

  // The Eliminator promo doc feeds the pinned leaderboard banner the modal
  // that explains the whole mechanic. (The Banana Draw equivalent went away
  // with its banner on 2026-07-31 — the draw is finished.)
  const eliminatorPromo = useMemo(() => promos.find(p => p.type === 'eliminator') ?? null, [promos]);

  const isClaimed = (p: Promo) =>
    claimedLocally.has(p.id) || (p.type === 'new-user' && newUserPromoClaimed);

  const hasVisibleClaim = (p: Promo) => {
    if (!p.claimable || isClaimed(p)) return false;
    if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
    return true;
  };

  const visiblePromos = useMemo(() => {
    return filterAndSortVisiblePromos(promos, {
      isBB3Holder,
      newUserPromoClaimed,
      hasSpunWheel: !!user?.hasSpunWheel,
      firstPurchaseBonusGranted: !!user?.firstPurchaseBonusGranted,
      firstPurchasePromoUnlocked: !!user?.firstPurchasePromoUnlocked,
      flagsKnown: isBalanceLoaded,
      isLoggedIn,
      hasVisibleClaim,
      isAdminPreview: isWalletAdmin(user?.walletAddress),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promos, isBB3Holder, newUserPromoClaimed, user?.hasSpunWheel, isTwitterVerified, claimedLocally, user?.firstPurchaseBonusGranted, user?.firstPurchasePromoUnlocked, isBalanceLoaded, isLoggedIn, user?.walletAddress]);

  const filteredPromos = useMemo(() => {
    // visiblePromos is already filter + sorted by the shared helper
    // (claimable first, then Boris's fixed order). The tab-filter
    // here just narrows the list further — order is preserved.
    if (filter === 'claimable') {
      return visiblePromos.filter(hasVisibleClaim);
    }
    if (filter === 'active') {
      return visiblePromos.filter(p => !hasVisibleClaim(p) && !isClaimed(p) && (p.progressMax || p.timerEndTime));
    }
    if (filter === 'locked') {
      return visiblePromos.filter(p =>
        ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) ||
        !isLoggedIn,
      );
    }
    return visiblePromos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePromos, filter, isTwitterVerified, isLoggedIn, claimedLocally, newUserPromoClaimed]);

  const claimableCount = useMemo(() => visiblePromos.filter(hasVisibleClaim).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePromos, isTwitterVerified, claimedLocally, newUserPromoClaimed]);

  // Total reward count across every claimable promo — sum of each
  // promo's `claimCount` (i.e. the per-claim multiplier shown on the
  // card buttons like "Claim · 11"). Used for the Claim All button
  // label and the Claimable stat tile so the number on the page
  // matches what the user actually nets when they hit the button.
  const totalClaimableRewards = useMemo(() => visiblePromos
    .filter(hasVisibleClaim)
    .reduce((sum, p) => sum + (p.claimCount || 1), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePromos, isTwitterVerified, claimedLocally, newUserPromoClaimed]);

  // Promos you're actively working toward right now — has a progress bar or a
  // live timer, not yet claimable or claimed. Answers "what's cooking" at a
  // glance on the stat row.
  const activeCount = useMemo(() => visiblePromos.filter(p =>
    !hasVisibleClaim(p) && !isClaimed(p) && (p.progressMax || p.timerEndTime)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePromos, isTwitterVerified, claimedLocally, newUserPromoClaimed]);

  // The Locked tab holds ONLY the X-gated promos (new-user + tweet-engagement
  // before X verification, or everything when logged out). Once the user
  // connects X there is nothing locked left — hide the tab entirely rather
  // than show an empty bucket (Boris 2026-07-13).
  const lockedCount = useMemo(() => visiblePromos.filter(p =>
    ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) ||
    !isLoggedIn).length,
    [visiblePromos, isTwitterVerified, isLoggedIn]);

  // If they verify X while sitting ON the Locked tab, it empties + disappears —
  // land them back on All instead of a vanished tab.
  useEffect(() => {
    if (filter === 'locked' && lockedCount === 0) setFilter('all');
  }, [filter, lockedCount]);

  // Spendable balances for the stat row.
  const freeSpins = user?.wheelSpins ?? 0;
  const freeDrafts = user?.freeDrafts ?? 0;
  const jpEntries = user?.jackpotEntries ?? 0;
  const hofEntries = user?.hofEntries ?? 0;
  const specialEntries = jpEntries + hofEntries;

  const handleClaim = async (promo: Promo): Promise<boolean> => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return false;
    }
    const count = promo.claimCount || 1;
    // NOTE: a promo claim must NEVER pre-determine a draft's type. Draft type
    // (Jackpot/HOF/Pro) is decided solely by the backend's provably-fair
    // guaranteed distribution at fill time. The old reservePromoDraftType()
    // call here forced the next draft's outcome — removed as a rigging vector.
    if (promosQuery.claimPromo) {
      const result = await promosQuery.claimPromo(promo.id);
      if (result instanceof Error) {
        // Claim failed silently — surface to the admin Logs tab so a
        // backend claim outage doesn't go unnoticed.
        reportClientError({
          source: LOG_SOURCES.promo.CLAIM_FAILED,
          message: result.message,
          route: 'promos',
          context: { promoId: promo.id, promoType: promo.type, count },
          stack: result.stack,
        });
        return false;
      }
      setClaimedLocally(prev => new Set([...Array.from(prev), promo.id]));
      return true;
    }
    setClaimedLocally(prev => new Set([...Array.from(prev), promo.id]));
    if (user) {
      if (promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + count });
      } else {
        updateUser({ wheelSpins: (user.wheelSpins || 0) + count });
      }
    }
    return true;
  };

  // Claim every visible-claimable promo, one at a time. Sequential
  // because each claim mutates user balance fields and the optimistic
  // updates inside usePromos.claimPromo would race with parallel
  // requests. Snapshot the list at click time so claims appearing
  // mid-run aren't auto-grabbed (the user can re-press).
  const handleClaimAll = async () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    if (isClaimingAll) return;
    const targets = visiblePromos.filter(hasVisibleClaim);
    if (targets.length === 0) return;
    setIsClaimingAll(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const promo of targets) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await handleClaim(promo);
        if (ok) succeeded += 1;
        else failed += 1;
      }
    } finally {
      setIsClaimingAll(false);
    }
    // Batch ended with at least one failure — report the partial result
    // so the admin Logs tab catches degraded claim-all runs.
    if (failed > 0) {
      reportClientError({
        source: LOG_SOURCES.promo.CLAIM_BATCH_PARTIAL_FAILED,
        message: `Claim-all completed with ${failed} of ${targets.length} claims failing`,
        route: 'promos',
        context: { total: targets.length, succeeded, failed },
      });
    }
  };

  return (
    <div className="w-full min-h-screen px-4 sm:px-8 lg:px-12 py-10 sm:py-14 max-w-5xl mx-auto">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="mb-10 sm:mb-14 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Promos</h1>
          <p className="text-white/40 text-sm sm:text-base mt-2">
            Earn free spins, drafts, and entries.
          </p>
        </div>
        {claimableCount > 0 && (
          <button
            type="button"
            onClick={() => void handleClaimAll()}
            disabled={isClaimingAll}
            className="shrink-0 px-5 py-2.5 bg-banana text-black text-sm font-semibold rounded-full hover:bg-banana/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isClaimingAll ? 'Claiming…' : `Claim all · ${totalClaimableRewards}`}
          </button>
        )}
      </div>

      {/* ── Banana Draw leaderboard ───────────────────────────────────
          Pinned above everything so it's seen without opening the promo
          (Boris 2026-07-26). Self-hides until there are Bananas in the pool,
          so it never shows an empty board — including before launch. */}
      {/* Public since the 2026-07-26 launch. Self-hides while the pool is
          empty, so it simply doesn't render until the first Bananas land. */}
      {/* ── THE ELIMINATOR leaderboard ────────────────────────────────
          Pinned ABOVE the Banana Draw board it succeeds (Richard 2026-07-31).
          Self-hides while nobody is on the list, so it renders nothing until
          the promo is green-lit and the first draft entries land. */}
      <EliminatorBanner
        myWallet={user?.walletAddress ?? null}
        onExplain={eliminatorPromo ? () => setSelectedPromo(eliminatorPromo) : undefined}
      />

      {/* ── Banana Draw banner: RETIRED 2026-07-31 (Richard) ──────────
          The draw gave out its 5th and final seat at noon PT today, after
          which this banner sat here showing a permanent "all 5 seats claimed"
          winners recap. The promo CARD retires itself on BANANA_DRAW_END_MS,
          but the banner was mounted separately with no such gate — so a
          finished promo kept occupying the top of the page, above the promo
          that replaced it. Unmounted rather than gated: the draw is over for
          good. components/promos/BananaDrawBanner.tsx is kept for reference. */}

      {/* ── Stat tiles — a clean TLDR: what's ready, what's cooking, and what
          you've got to spend. Minimal single card with internal dividers. ─── */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] mb-10 grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/[0.06]">
        <StatTile
          label="Claimable"
          value={totalClaimableRewards}
          sublabel={claimableCount > 0 ? 'ready to claim now' : 'all caught up'}
          highlight={totalClaimableRewards > 0}
        />
        <StatTile
          label="In progress"
          value={activeCount}
          sublabel={activeCount > 0 ? 'promos still earning' : 'nothing active'}
        />
        <StatTile
          label="Free spins"
          value={freeSpins}
          sublabel={freeSpins > 0 ? 'use on the Banana Wheel' : 'none right now'}
        />
        <StatTile
          label="Free drafts"
          value={freeDrafts}
          sublabel={specialEntries > 0
            ? `+ ${jpEntries} JP · ${hofEntries} HOF entries`
            : (freeDrafts > 0 ? 'enter a draft free' : 'none right now')}
        />
      </div>

      {/* ── Filter — Apple segmented control ───────────────────────────── */}
      <div className="mb-6 flex">
        <div className="inline-flex items-center bg-white/[0.04] rounded-full p-1 gap-0.5">
          {([
            ['all',       'All',       visiblePromos.length],
            ['claimable', 'Claimable', claimableCount],
            ['active',    'In progress', null],
            // Locked only exists while something IS locked (X not connected /
            // logged out) — it vanishes cleanly once X is verified.
            ...(lockedCount > 0 ? [['locked', 'Locked', null]] : []),
            ['activity',  'Activity',  null],
          ] as [FilterKey, string, number | null][]).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                filter === key
                  ? 'bg-white text-black'
                  : 'text-white/55 hover:text-white/80'
              }`}
            >
              {label}
              {count !== null && count > 0 && (
                <span className={`ml-1.5 tabular-nums ${filter === key ? 'opacity-50' : 'opacity-40'}`}>{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading state ──────────────────────────────────────────────── */}
      {filter !== 'activity' && promosQuery.isLoading && visiblePromos.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-52 rounded-2xl bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty filter state ─────────────────────────────────────────── */}
      {filter !== 'activity' && !promosQuery.isLoading && filteredPromos.length === 0 && visiblePromos.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
          <p className="text-white/45 text-sm">Nothing in this filter.</p>
          <button onClick={() => setFilter('all')} className="text-banana text-xs mt-3 hover:underline">
            Show all
          </button>
        </div>
      )}

      {/* ── Activity tab — the full-picture hub. Reuses the profile
          ActivityHistory feed (SSE, real-time), filtered to promo-relevant
          events: spins won, promos claimed, passes bought, drafts won — each
          timestamped. Same styling language as the cards. ──────────────────── */}
      {filter === 'activity' && (
        <ActivityHistory
          userId={user?.id ?? null}
          filterTypes={['spin_won', 'promo_claimed', 'pass_purchased', 'pass_granted', 'draft_won']}
          title="Your Promo Activity"
          emptyText="Spins you win, promos you claim, passes you buy, and drafts you win show up here."
        />
      )}

      {/* ── Promo grid ─────────────────────────────────────────────────── */}
      {filter !== 'activity' && filteredPromos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredPromos.map(promo => (
            <PromoCard
              key={promo.id}
              promo={promo}
              isClaimed={isClaimed(promo)}
              hasVisibleClaim={hasVisibleClaim(promo)}
              onClick={() => setSelectedPromo(promo)}
              onClaim={() => void handleClaim(promo)}
              wallet={user?.walletAddress ?? null}
            />
          ))}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {filteredPromos.length > 0 && (
        <div className="mt-12 flex flex-wrap gap-x-4 gap-y-2 items-center justify-center text-xs text-white/40">
          <button onClick={() => router.push('/buy-drafts')} className="hover:text-white/70 transition-colors">
            Buy drafts
          </button>
          <span className="text-white/15">·</span>
          <button onClick={() => router.push('/banana-wheel')} className="hover:text-white/70 transition-colors">
            Spin the wheel
          </button>
        </div>
      )}

      {/* ── Detail modal ───────────────────────────────────────────────── */}
      <PromoModal
        drawDraftId={drawQueryId}
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

// ─── Stat tile — Apple-Fitness-style numeric cell, no gradients ───────
function StatTile({ label, value, sublabel, highlight }: {
  label: string;
  value: number | string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1.5">{label}</p>
      <p
        className="font-semibold text-3xl tabular-nums tracking-tight"
        style={{ color: highlight ? '#fbbf24' : '#fff' }}
      >
        {value}
      </p>
      {sublabel && <p className="text-white/30 text-[11px] mt-1.5">{sublabel}</p>}
    </div>
  );
}

// ─── Promo card — clean glass surface, single accent dot, no emoji ────
interface PromoCardProps {
  promo: Promo;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onClick: () => void;
  onClaim: () => void;
  /** THE DROP card shows this wallet's pack count next to the countdown. */
  wallet: string | null;
}

function PromoCard({ promo, isClaimed, hasVisibleClaim, onClick, onClaim, wallet }: PromoCardProps) {
  const style = TYPE_STYLES[promo.type];
  const progressMax = promo.progressMax || 0;
  // Stacking promos (Buy-10 spin, buy-bonus) repeat: after claiming, the bar
  // keeps showing the real rolled-over progress (0/10), never a full bar or a
  // persistent "Claimed" — both read as "done, can't earn again".
  const isStacking = promo.type === 'mint' || promo.type === 'buy-bonus';
  const progressCurrent = isClaimed && !isStacking ? progressMax : (promo.progressCurrent || 0);
  const progressPercent = progressMax > 0 ? Math.min(100, (progressCurrent / progressMax) * 100) : 0;

  // Chase Your Pick: live state (pick slot, next-hit spins, 24h countdown) —
  // the meter (x/5) and the always-on clock read the same on every surface.
  const isChase = promo.type === 'pick-chase';
  const chase = isChase ? deriveChaseState(promo) : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isChase && !promo.timerEndTime) return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [isChase, promo.timerEndTime]);

  // Banana Draw draws its own inline row too (bananas · odds · countdown).
  // Live numbers come from the promo payload, restamped on every /api/promos
  // read, so the card updates without its own fetch.
  const isBanana = promo.type === 'banana-draw';
  const bd = isBanana ? promo.modalContent.bananaDraw : undefined;

  // Chase draws its own inline row (pick · attempt · countdown) — no x/5 meter,
  // so it's excluded from the generic progress bar below.
  const showProgress = !isChase && !isBanana && progressMax > 0;
  // Chase always shows the clock — dormant reads a full 24:00:00 that hasn't started.
  const timeRemaining = promo.timerEndTime
    ? formatTimeRemaining(promo.timerEndTime)
    : (isChase ? '24:00:00' : '');

  // Single status indicator. Restrained — small dot + label, no pulsing.
  const isClaimedPersistent =
    isClaimed && promo.type !== 'daily-drafts' && promo.type !== 'pick-10' && !isStacking;

  return (
    <button
      onClick={onClick}
      className={`
        relative group w-full text-left rounded-2xl border bg-white/[0.02] backdrop-blur-xl
        transition-all duration-200 ease-out
        ${hasVisibleClaim || promo.featured
          ? 'border-banana/40 hover:border-banana/60'
          : 'border-white/[0.06] hover:border-white/[0.12]'}
        hover:bg-white/[0.04]
      `}
    >
      {/* NEW indicator — big banana pill for the featured promo, subtle text otherwise */}
      {promo.isNew && (promo.featured ? (
        <span className="absolute -top-3 right-4 z-10 inline-flex items-center rounded-full bg-banana px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_24px_rgba(251,191,36,0.5)]">
          New
        </span>
      ) : (
        <span className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-banana font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-banana" />
          New
        </span>
      ))}

      <div className="p-5 sm:p-6 flex flex-col h-full min-h-[13rem]">
        {/* Type label — small dot + plain text, color-restrained */}
        <div className="flex items-center gap-1.5 mb-4">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.accent }} />
          <span className="text-[11px] uppercase tracking-wider text-white/40 font-medium">
            {style.label}
          </span>
        </div>

        {/* Title + description — Apple-style typographic hierarchy */}
        <h3 className="text-white font-semibold text-lg sm:text-xl leading-snug tracking-tight mb-2">
          {promo.title}
        </h3>
        {/* THE DROP: how close 8pm is, on the card itself. */}
        {promo.type === 'drop' && (
          <div className="mb-2 text-[15px] font-bold text-white/85">
            <DropCountdown wallet={wallet} />
          </div>
        )}
        <SpinExplainer promoTitle={promo.title} promoType={promo.type} className="block text-xs leading-relaxed text-banana/80 mb-2" />
        <p className="text-white/45 text-sm leading-relaxed line-clamp-2 mb-4">
          {promo.description}
        </p>

        {/* Chase Your Pick — bottom row: live countdown, plus (once a draft locks
            a pick) the slot, attempts, and next-hit Spins. No x/5 meter. */}
        {isChase && (
          <div className="mt-auto mb-4">
            {chase?.active ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] whitespace-nowrap text-white/70">
                  <span className="font-bold text-[#f97316]">Pick {chase.slot}</span>
                  <span className="text-white/25"> · </span>Att {chase.attempt}
                  <span className="text-white/25"> → </span>
                  <span className="font-bold text-[#f97316]">{chase.nextHit} {chase.nextHit === 1 ? 'Spin' : 'Spins'}{chase.isMax ? ' MAX' : ''}</span>
                </span>
                <span className="shrink-0 text-[15px] font-bold tabular-nums text-white/85">{timeRemaining}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-white/45">Draft to lock your pick</span>
                <span className="text-[15px] font-bold tabular-nums text-white/85">{timeRemaining}</span>
              </div>
            )}
          </div>
        )}
        {/* Banana Draw — live: what you hold and the 24h clock. Mirrors the
            Match Your Pick row so the cards read the same. Share % is
            deliberately NOT shown anywhere (Boris 2026-07-26). */}
        {isBanana && (
          <div className="mt-auto mb-4">
            <div className="flex items-center justify-between gap-2">
              {bd && bd.bananas > 0 ? (
                <span className="text-[13px] whitespace-nowrap text-white/70">
                  <span className="font-bold text-[#ef6c37]">🍌 {bd.bananas}</span>
                  {bd.pending > 0 && <><span className="text-white/25"> · </span>{bd.pending} filling</>}
                </span>
              ) : (
                <span className="text-[13px] text-white/45">Fill a draft to earn Bananas</span>
              )}
              <span className="shrink-0 text-[15px] font-bold tabular-nums text-white/85">{timeRemaining || '24:00:00'}</span>
            </div>
          </div>
        )}

        {/* Progress — hairline, banana fill on claimable, neutral otherwise.
            Kickoff buy-bonus also prints lifetime drafts counted toward its
            20-draft cap (modalContent.totalMinted) next to the pair meter. */}
        {showProgress && (
          <div className="mt-auto mb-4">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-white/55 text-xs tabular-nums">
                {promo.type === 'buy-bonus'
                  ? `${progressCurrent} / ${progressMax} · ${Math.min(promo.modalContent?.totalMinted || 0, API_CONFIG.promos.buyBonus.maxPassesCounted)}/${API_CONFIG.promos.buyBonus.maxPassesCounted} drafts · Max ${API_CONFIG.promos.buyBonus.maxPassesCounted}`
                  : `${progressCurrent} / ${progressMax}`}
              </span>
              {timeRemaining && (
                <span className="text-white/85 text-[15px] font-bold tabular-nums">{timeRemaining}</span>
              )}
            </div>
            <div className="h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPercent}%`,
                  background: hasVisibleClaim ? '#fbbf24' : 'rgba(255,255,255,0.45)',
                }}
              />
            </div>
          </div>
        )}

        {/* Bottom row: status + action */}
        <div className={`flex items-center justify-between gap-3 ${showProgress ? '' : 'mt-auto'}`}>
          {/* Status indicator — minimal */}
          <div className="flex-1 min-w-0">
            {hasVisibleClaim ? (
              <span className="text-banana text-xs font-medium">Ready to claim</span>
            ) : isClaimedPersistent ? (
              <span className="inline-flex items-center gap-1 text-white/45 text-xs">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Claimed
              </span>
            ) : showProgress ? (
              <span className="text-white/35 text-xs">In progress</span>
            ) : (
              <span className="text-white/35 text-xs">Tap for details</span>
            )}
          </div>

          {hasVisibleClaim && (
            <button
              onClick={(e) => { e.stopPropagation(); onClaim(); }}
              className="shrink-0 px-4 py-1.5 bg-banana text-black text-xs font-semibold rounded-full hover:bg-banana/90 active:scale-[0.97] transition-all"
            >
              {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim'}
            </button>
          )}
        </div>
      </div>
    </button>
  );
}
