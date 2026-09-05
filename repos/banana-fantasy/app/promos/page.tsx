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
import { API_CONFIG } from '@/lib/api/config';
import { EliminatorBanner } from '@/components/promos/EliminatorBanner';
import { PromoSpotlight, PromoLongCard } from '@/components/promos/PromoCards';
// HypeCard import removed — Banana Hype RETIRED 2026-09-03, permanent.
import { BananaRaceCard } from '@/components/race/BananaRaceCard';
import { ActivityHistory } from '@/components/profile/ActivityHistory';
import type { Promo } from '@/types';

type FilterKey = 'all' | 'claimable' | 'active' | 'locked' | 'activity';

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
  // First-purchase copy variant (server-computed) — same rule as the carousel.
  const fpVariant: 'new' | 'returning' = user?.firstPurchaseVariant === 'returning' ? 'returning' : 'new';
  const fpShowNewPlayerTag = !isLoggedIn || user?.firstPurchaseVariant == null;

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
        <div>
          <div className="h-56 rounded-[24px] bg-white/[0.03] animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[168px] rounded-[20px] bg-white/[0.02] animate-pulse" />
            ))}
          </div>
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

      {/* ── Promo cards — SPOTLIGHT (whatever the shared sort puts first:
          conversion card for new players, otherwise the featured pin, or a
          claimable one) + LONG cards under it. Two columns on desktop, one on
          phones. Tap a card → inline "How it works"; "Full details" → modal. */}
      {/* Banana Race (kickoff-week leaderboard) — renders nothing until
          system_config/bananaRace.enabled is on. */}
      {filter !== 'activity' && <div className="mb-3.5 empty:hidden"><BananaRaceCard /></div>}
      {filter !== 'activity' && filteredPromos.length > 0 && (() => {
        const showSpot = filter === 'all';
        // TWO stacked spotlights while the onboarding pair is live (Boris
        // 2026-08-19): when the sort puts new-user and/or first-purchase at
        // the top, each gets the big treatment until it disappears (spin
        // claimed / first order) — then ATB (or whatever sorts first) takes
        // the single spotlight as before.
        const ONBOARD = new Set(['new-user', 'first-purchase']);
        let spotCount = 1;
        if (showSpot && filteredPromos.length > 1
            && ONBOARD.has(filteredPromos[0].type) && ONBOARD.has(filteredPromos[1].type)) {
          spotCount = 2;
        }
        const spots = showSpot ? filteredPromos.slice(0, spotCount) : [];
        const longs = showSpot ? filteredPromos.slice(spotCount) : filteredPromos;
        return (
          <>
            {spots.map((spot, si) => (
              <div key={spot.id} className={si > 0 ? 'mt-3.5' : ''}>
                <PromoSpotlight
                  promo={spot}
                  wallet={user?.walletAddress ?? null}
                  isClaimed={isClaimed(spot)}
                  hasVisibleClaim={hasVisibleClaim(spot)}
                  onOpenModal={() => setSelectedPromo(spot)}
                  onClaim={() => void handleClaim(spot)}
                  fpVariant={fpVariant}
                  fpShowNewPlayerTag={fpShowNewPlayerTag}
                />
              </div>
            ))}
            {longs.length > 0 && (
              <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3.5 ${showSpot ? 'mt-4' : ''}`}>
                {longs.flatMap((promo, i) => [
                  // Banana Hype RETIRED 2026-09-03 (final week paid out; Boris:
                  // permanent, never bring back).
                  (
                  <PromoLongCard
                    key={promo.id}
                    promo={promo}
                    index={i}
                    wallet={user?.walletAddress ?? null}
                    isClaimed={isClaimed(promo)}
                    hasVisibleClaim={hasVisibleClaim(promo)}
                    onOpenModal={() => setSelectedPromo(promo)}
                    onClaim={() => void handleClaim(promo)}
                    fpVariant={fpVariant}
                    fpShowNewPlayerTag={fpShowNewPlayerTag}
                  />
                  ),
                ])}
                {/* Hype filler card removed — promo retired 2026-09-03. */}
              </div>
            )}
          </>
        );
      })()}

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
