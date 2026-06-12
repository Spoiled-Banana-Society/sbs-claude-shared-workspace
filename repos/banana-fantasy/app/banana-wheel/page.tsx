'use client';

import React, { useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';

const BananaWheel = dynamic(() => import('@/components/wheel/BananaWheel').then(m => ({ default: m.BananaWheel })), {
  ssr: false,
  loading: () => <div className="w-[300px] h-[300px] mx-auto bg-bg-tertiary rounded-full animate-pulse" />,
});
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { WheelProofBanner } from '@/components/wheel/WheelProofBanner';
import { useAuth } from '@/hooks/useAuth';
import { fetchJson } from '@/lib/appApiClient';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { pushNotification } from '@/components/NotificationCenter';
import { useWheelHistory, useSpin, type WheelSpinOutcome } from '@/hooks/useWheelData';
import { usePromos } from '@/hooks/usePromos';
import { wheelSegments, type WheelSegment } from '@/lib/wheelConfig';
import { SPIN_DURATION_MS } from '@/components/wheel/BananaWheel';
import { useQueryClient } from '@tanstack/react-query';

export default function BananaWheelPage() {
  const { user, updateUser, isLoading, isBalanceLoaded, refreshBalance, refreshBalanceUntil, freezeSpinReveal } = useAuth();
  const spinMutation = useSpin(user?.id);
  const queryClient = useQueryClient();
  const promosQuery = usePromos({ userId: user?.id });
  const [queuedJP, setQueuedJP] = React.useState(0);
  const [queuedHOF, setQueuedHOF] = React.useState(0);
  React.useEffect(() => {
    if (!user?.id) return;
    fetchJson<Record<string, { rounds?: Array<{ status: string; members: Array<{ wallet: string }> }> }>>('/api/queues')
      .then(queues => {
        const countQueued = (type: string) => {
          const q = queues[type];
          if (!q?.rounds) return 0;
          return q.rounds.filter(r => r.status === 'filling' && r.members.some(m => m.wallet === user.id)).length;
        };
        setQueuedJP(countQueued('jackpot'));
        setQueuedHOF(countQueued('hof'));
      }).catch((err) => {
        reportClientError({
          source: LOG_SOURCES.wheel.QUEUE_FETCH_FAILED,
          message: err instanceof Error ? err.message : String(err),
          route: 'banana-wheel',
          context: { userId: user?.id },
          stack: err instanceof Error ? err.stack : undefined,
        });
      });
  }, [user?.id]);

  const historyQuery = useWheelHistory(user?.id);
  const spinHistory = historyQuery.data ?? [];

  // Lifetime spin winnings — the "My Winnings" scoreboard. Computed from the
  // full spin history (cumulative, never decreases), unlike the spendable
  // balances which drop when a pass/entry is used. Stored `prize` is the
  // source of truth; legacy rows without one derive from the segment id.
  const wonTotals = useMemo(() => {
    let drafts = 0;
    let jackpot = 0;
    let hof = 0;
    for (const s of spinHistory) {
      const p = s.prize;
      if (p && typeof p === 'object' && p.type) {
        if (p.type === 'draft_pass' && typeof p.value === 'number') drafts += p.value;
        else if (p.type === 'custom' && p.value === 'jackpot') jackpot += 1;
        else if (p.type === 'custom' && p.value === 'hof') hof += 1;
        continue;
      }
      const r = s.result || '';
      if (r.startsWith('jackpot')) jackpot += 1;
      else if (r.startsWith('hof')) hof += 1;
      else {
        const m = r.match(/^draft-(\d+)/);
        if (m) drafts += Number(m[1]);
      }
    }
    return { drafts, jackpot, hof };
  }, [spinHistory]);

  const spinsAvailable = Math.max(0, user?.wheelSpins ?? 0);

  const segmentMap = useMemo(() => new Map(wheelSegments.map((segment) => [segment.id, segment])), []);

  const handleSpin = useCallback(async (): Promise<WheelSpinOutcome | null> => {
    // Freeze global spin-reveal updates for the duration of the wheel
    // animation so the header's draft passes / wheel spins counts AND
    // the profile activity feed don't tick mid-spin (would spoil the
    // reveal). The +800ms buffer covers the small window between
    // mutation start and the wheel actually beginning to spin, plus
    // the post-landing prize reveal frame. Any SSE payload arriving
    // during the freeze is queued and applied automatically when the
    // freeze expires — no balance data is lost.
    // The wheel now starts spinning instantly and only the ~1.3s landing
    // happens AFTER the RNG request resolves. The network leg is variable
    // (slow on mobile), so freeze once up front, then re-extend the freeze
    // the moment the result lands to cover the landing window — otherwise a
    // slow network could let the balance tick before the wheel stops and
    // spoil the prize.
    freezeSpinReveal(SPIN_DURATION_MS + 800);
    const outcome = await spinMutation.mutateAsync();
    freezeSpinReveal(SPIN_DURATION_MS + 800);
    return outcome;
  }, [spinMutation, freezeSpinReveal]);

  const handleSpinComplete = useCallback(
    (_outcome: WheelSpinOutcome, segment: WheelSegment | null) => {
      // Invalidate the spin-history query NOW (not on mutation success) so
      // the right-column "Spin History" only shows the new win after the
      // wheel lands. Used to fire from useSpin.onSuccess which ran the
      // moment the server returned — that was ~5s before the wheel
      // animation finished, spoiling the reveal.
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: ['wheel', 'history', user.id] });
      }

      // Pull in the authoritative wheelSpins decrement + fresh balance from
      // the server. The global balance freeze (set in handleSpin) has just
      // expired or is about to — any incoming SSE payload during the freeze
      // was queued and is being applied right around now.
      refreshBalance().catch((err) => {
        reportClientError({
          source: LOG_SOURCES.wheel.BALANCE_REFRESH_TIMEOUT,
          message: err instanceof Error ? err.message : String(err),
          route: 'banana-wheel',
          context: { userId: user?.id, phase: 'spin_complete_refresh' },
          stack: err instanceof Error ? err.stack : undefined,
        });
      });

      // Tell the server the spinner has seen their prize. This bumps
      // wheel_periods.feedRevealCount, which is the trigger /wheel-batches'
      // live feed listens to. Without this call, the spin would never
      // appear in the public feed.
      if (_outcome?.spinId) {
        fetch(`/api/wheel/spin/${encodeURIComponent(_outcome.spinId)}/confirm-reveal`, {
          method: 'POST',
        }).catch((err) => {
          /* silent — feed will self-heal on next confirmed spin */
          reportClientError({
            source: LOG_SOURCES.wheel.SPIN_REVEAL_CONFIRM_FAILED,
            message: err instanceof Error ? err.message : String(err),
            route: 'banana-wheel',
            context: { userId: user?.id, spinId: _outcome.spinId },
            stack: err instanceof Error ? err.stack : undefined,
          });
        });
      }

      if (!user || !segment) return;
      if (segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number') {
        const expectedDraftPasses = (user.draftPasses ?? 0) + segment.prizeValue;
        updateUser({ freeDrafts: (user.freeDrafts || 0) + segment.prizeValue });
        // Live-sync: wait for the reserveTokens mint fired by the spin endpoint
        // to be visible on-chain, then the UI reflects the new NFT without a
        // refresh. Self-heals admin panel via Firestore writethrough too.
        refreshBalanceUntil((b) => b.draftPasses >= expectedDraftPasses, {
          timeoutMs: 15_000,
          intervalMs: 1_000,
        }).catch((err) => {
          reportClientError({
            source: LOG_SOURCES.wheel.BALANCE_REFRESH_TIMEOUT,
            message: err instanceof Error ? err.message : String(err),
            route: 'banana-wheel',
            context: { userId: user?.id, phase: 'draft_pass_mint_wait', expectedDraftPasses },
            stack: err instanceof Error ? err.stack : undefined,
          });
        });
        // Count in the title: "Free Draft Won!" for 1, "2 Free Drafts Won!"
        // for 2+ (Boris 2026-06-10). This is THE win bell entry — fired at
        // the exact moment the wheel stops; the server deliberately doesn't
        // fire one (it double-notified and the timing was off).
        pushNotification({
          type: 'promo',
          title: segment.prizeValue === 1 ? 'Free Draft Won!' : `${segment.prizeValue} Free Drafts Won!`,
          message: `You won ${segment.prizeValue} free draft${segment.prizeValue !== 1 ? 's' : ''} on the Banana Wheel!`,
          link: '/drafting',
          icon: 'ticket',
          // Stable key → idempotent server doc AND the instant local bell
          // insert in pushNotification (entry shows the ms the wheel stops).
          ...(_outcome?.spinId ? { dedupeKey: `spin-win-${_outcome.spinId}` } : {}),
        });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        updateUser({ jackpotEntries: (user.jackpotEntries || 0) + 1 });
        pushNotification({
          type: 'jackpot_queue',
          title: 'Jackpot Draft Won!',
          message: 'You won a Jackpot draft! You\'re in the queue (8-hour picks) — it starts as soon as 10 winners join.',
          link: '/drafting',
          ...(_outcome?.spinId ? { dedupeKey: `spin-win-${_outcome.spinId}` } : {}),
        });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        updateUser({ hofEntries: (user.hofEntries || 0) + 1 });
        pushNotification({
          type: 'hof_queue',
          title: 'HOF Draft Won!',
          message: 'You won a HOF draft! You\'re in the queue (8-hour picks) — it starts as soon as 10 winners join.',
          link: '/drafting',
          ...(_outcome?.spinId ? { dedupeKey: `spin-win-${_outcome.spinId}` } : {}),
        });
      }
    },
    [updateUser, user, refreshBalance, refreshBalanceUntil, queryClient],
  );

  const prizeSummary = useMemo(() => {
    const summary = new Map<string, { label: string; color: string; probability: number }>();
    for (const segment of wheelSegments) {
      const key = `${segment.prizeType}:${segment.prizeValue ?? ''}:${segment.label}`;
      const existing = summary.get(key);
      if (existing) {
        existing.probability += segment.probability;
      } else {
        summary.set(key, { label: segment.label, color: segment.color, probability: segment.probability });
      }
    }
    return Array.from(summary.values()).sort((a, b) => b.probability - a.probability);
  }, []);

  const getPrizeLabel = (segmentId: string): string => segmentMap.get(segmentId)?.label ?? '';
  const getPrizeColor = (segmentId: string): string => segmentMap.get(segmentId)?.color ?? '#94a3b8';

  // Format a spin timestamp into the user's local-timezone short form,
  // e.g. "May 23, 11:43 PM". Raw ISO strings ("2026-05-24T03:43:43.109Z")
  // were unreadable in the sidebar and didn't show local time.
  // `toLocaleString` automatically uses the browser's IANA timezone.
  const formatSpinDate = (raw: string): string => {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const dataReady = !isLoading && (!user || isBalanceLoaded);

  if (!dataReady) {
    const skeletonBar = "h-[18px] rounded bg-white/10 animate-pulse";
    const skeletonCard = (
      <div
        className="rounded-2xl p-6 backdrop-blur-md"
        style={{
          background: 'rgba(20, 20, 20, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div className={`${skeletonBar} w-[100px] mb-4`} />
        <div className="space-y-3.5">
          <div className="flex justify-between"><div className={`${skeletonBar} w-[80px]`} /><div className={`${skeletonBar} w-[30px]`} /></div>
          <div className="flex justify-between"><div className={`${skeletonBar} w-[60px]`} /><div className={`${skeletonBar} w-[30px]`} /></div>
          <div className="flex justify-between"><div className={`${skeletonBar} w-[70px]`} /><div className={`${skeletonBar} w-[30px]`} /></div>
        </div>
      </div>
    );
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-4">
        <div className="text-center mb-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
          <h1 className="text-[28px] font-semibold text-white tracking-tight mb-1">Banana Wheel</h1>
          <p className="text-white text-[14px]">Spin to win Free Drafts and Special Entries</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 items-start">
          <div className="flex flex-col gap-4 order-3 lg:order-1">
            {skeletonCard}
            {skeletonCard}
          </div>
          <div className="flex justify-center order-1 lg:order-2">
            <div className="w-[300px] h-[300px] bg-bg-tertiary rounded-full animate-pulse" />
          </div>
          <div className="flex flex-col gap-4 order-2 lg:order-3 mt-12 lg:mt-0">
            {skeletonCard}
            {skeletonCard}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-4">
      {/* Page Header */}
      <div className="text-center mb-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mb-1">Banana Wheel</h1>
        <p className="text-white text-[14px]">Spin to win Free Drafts and Special Entries</p>
      </div>

      {/*
        Main Layout — three columns on desktop, single-column on mobile.

        Information architecture (Boris-approved 2026-05-23):
        - LEFT  ("what you're playing for"): Prizes on Wheel → What Are These?
        - CENTER:                            the Wheel itself
        - RIGHT ("your outcome + how to trust it"): My Winnings + history →
                                             Verified Fair

        Mobile stack order (most personal → least urgent):
          1. Wheel (always first — the action)
          2. My Winnings + history (your scoreboard)
          3. Verified Fair (proof anchor)
          4. Prizes on Wheel (reference)
          5. What Are These? (educational, last)

        Achieved by giving each COLUMN wrapper an `order-N` for mobile and a
        `lg:order-N` for desktop. Items inside each wrapper keep DOM order on
        both breakpoints.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 items-start">
        {/* LEFT column on desktop (order-1); mobile bottom (order-3) */}
        <div className="flex flex-col gap-4 order-3 lg:order-1">
          {/* Prizes on Wheel */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">Prizes on Wheel</h3>
            <div className="space-y-3.5 text-[14px]">
              {prizeSummary.map((item) => (
                <div key={`${item.label}-${item.probability}`} className="flex justify-between items-baseline">
                  <span className="font-semibold" style={{ color: item.color }}>{item.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: item.color }}>{(item.probability * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* What Are These? */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">What Are These?</h3>
            <div className="space-y-4 text-[13px]">
              <div>
                <span className="text-[#ff6b6b] font-bold text-[15px]">Jackpot</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Land on Jackpot and you&apos;re placed into a Jackpot league. Win that league and skip straight to the finals!
                </p>
              </div>
              <div>
                <span className="text-[#ffd60a] font-bold text-[15px]">HOF</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Land on HOF and you&apos;re placed into a HOF league. Compete for bonus prizes on top of regular rewards!
                </p>
              </div>
              <div>
                <span className="text-[#32d74b] font-bold text-[15px]">Free Drafts</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Free drafts can only be used to draft. They cannot be used for promos.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER — Wheel. Mobile first (order-1), desktop middle column (order-2). */}
        <div className="flex justify-center order-1 lg:order-2">
          <BananaWheel
            spinsAvailable={spinsAvailable}
            onSpin={handleSpin}
            onSpinComplete={handleSpinComplete}
          />
        </div>

        {/* RIGHT column on desktop (order-3); mobile sits right under the wheel (order-2) */}
        <div className="flex flex-col gap-4 order-2 lg:order-3 mt-12 lg:mt-0">
          {/*
            My Winnings + Recent Spins — combined card.
            Top section = scoreboard (totals). Bottom section = history.
            Joined by a hairline divider so they read as one card, not two.
          */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white tracking-tight">My Winnings</h3>

            {/* Totals — big number = LIFETIME won from spins (cumulative, never
                drops); muted suffix = spendable balance left right now. Both
                live: totals bump when the wheel lands, "left" rides the
                real-time balance stream (drops the moment a pass is used). */}
            <div className="mt-4 space-y-3.5">
              <div className="flex justify-between items-baseline">
                <span className="text-white text-[14px] font-medium">Free Drafts</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[#32d74b] font-semibold text-[16px] tabular-nums">{wonTotals.drafts}</span>
                  <span className="text-white/35 text-[12px] tabular-nums">won · {user?.freeDrafts || 0} left</span>
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-white text-[14px] font-medium">Jackpot</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[#ff6b6b] font-semibold text-[16px] tabular-nums">{wonTotals.jackpot}</span>
                  <span className="text-white/35 text-[12px] tabular-nums">won · {(user?.jackpotEntries || 0) + queuedJP} left</span>
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-white text-[14px] font-medium">HOF</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[#ffd60a] font-semibold text-[16px] tabular-nums">{wonTotals.hof}</span>
                  <span className="text-white/35 text-[12px] tabular-nums">won · {(user?.hofEntries || 0) + queuedHOF} left</span>
                </span>
              </div>
            </div>

            {/* Hairline section divider — 1px @ 6% white, Apple-style */}
            <div className="my-5 h-px bg-white/[0.06]" />

            {/* Recent Spins — small-caps subheader keeps the section subordinate to "My Winnings" */}
            <div className="flex items-baseline justify-between mb-3">
              <h4 className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Recent Spins</h4>
              {spinHistory.length > 0 && (
                <span className="text-white/25 text-[10px]">tap to verify</span>
              )}
            </div>

            {spinHistory.length > 0 ? (
              // 5-row visible window — same height target as the previous standalone
              // history card. Custom scrollbar is the slim 6px style so it doesn't
              // shout. Rows have a subtle hover state and the proof arrow tints to
              // banana on hover for affordance.
              <div
                className="max-h-[180px] overflow-y-auto -mr-2 pr-2 [&::-webkit-scrollbar]:w-[6px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20"
              >
                <div className="space-y-0.5">
                  {spinHistory.map((spin) => (
                    <a
                      key={spin.id}
                      href={`/spin-proof/${spin.spinId}`}
                      className="flex items-center justify-between gap-3 -mx-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors group"
                      title="View proof"
                    >
                      <span className="text-white/55 text-[12px] tabular-nums truncate">{formatSpinDate(spin.date)}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[13px] font-medium" style={{ color: getPrizeColor(spin.result) }}>
                          {getPrizeLabel(spin.result)}
                        </span>
                        <span className="text-white/20 group-hover:text-banana text-[10px] transition-colors">↗</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-white/30 text-[12px] py-2 text-center">No spins yet — your wins will land here.</p>
            )}
          </div>

          <WheelProofBanner />
        </div>
      </div>

      {/* Promo cards — the carousel renders its own heading. Tight gap now
          that the "Earn spins by" list + extra heading are gone. */}
      <section id="earn-spins" className="mt-8 lg:mt-14 scroll-mt-24">
        <PromoCarousel
          heading="Promos to Earn Spins"
          promos={promosQuery.data ?? []}
          autoPlay={false}
          claimPromo={promosQuery.claimPromo}
          onVerifyTweet={promosQuery.verifyTweetEngagement}
          onGenerateReferralCode={promosQuery.generateReferralCode}
        />
      </section>
    </div>
  );
}
