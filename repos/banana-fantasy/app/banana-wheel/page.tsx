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
    freezeSpinReveal(SPIN_DURATION_MS + 800);
    return spinMutation.mutateAsync();
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
        pushNotification({
          type: 'promo',
          title: 'Free Drafts Won!',
          message: `You won ${segment.prizeValue} free draft${segment.prizeValue !== 1 ? 's' : ''} on the Banana Wheel!`,
          link: '/drafting',
        });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        updateUser({ jackpotEntries: (user.jackpotEntries || 0) + 1 });
        pushNotification({
          type: 'jackpot_queue',
          title: '🔥 Jackpot Draft Queued!',
          message: 'You\'re in the Jackpot queue (8-hour picks). Draft starts as soon as 10 winners join!',
          link: '/drafting',
        });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        updateUser({ hofEntries: (user.hofEntries || 0) + 1 });
        pushNotification({
          type: 'hof_queue',
          title: '🏆 HOF Draft Queued!',
          message: 'You\'re in the HOF queue (8-hour picks). Draft starts as soon as 10 winners join!',
          link: '/drafting',
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
          <div className="flex flex-col gap-4 order-2 lg:order-1">
            {skeletonCard}
            {skeletonCard}
          </div>
          <div className="flex justify-center order-1 lg:order-2">
            <div className="w-[300px] h-[300px] bg-bg-tertiary rounded-full animate-pulse" />
          </div>
          <div className="flex flex-col gap-4 order-3">
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

      {/* Main Layout - Wheel in center, info on sides */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 items-start">
        {/* Left Column */}
        <div className="flex flex-col gap-4 order-2 lg:order-1">
          {/* My Winnings */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">My Winnings</h3>
            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">Free Drafts</span>
                <span className="text-[#32d74b] font-semibold text-[16px]">{user?.freeDrafts || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">Jackpot</span>
                <span className="text-[#ff6b6b] font-semibold text-[16px]">{(user?.jackpotEntries || 0) + queuedJP}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">HOF</span>
                <span className="text-[#ffd60a] font-semibold text-[16px]">{(user?.hofEntries || 0) + queuedHOF}</span>
              </div>
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

        {/* Center - Wheel */}
        <div className="flex justify-center order-1 lg:order-2">
          <BananaWheel
            spinsAvailable={spinsAvailable}
            onSpin={handleSpin}
            onSpinComplete={handleSpinComplete}
          />
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4 order-3">
          {/* Prizes */}
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
                <div key={`${item.label}-${item.probability}`} className="flex justify-between">
                  <span className="font-bold" style={{ color: item.color }}>{item.label}</span>
                  <span className="font-bold" style={{ color: item.color }}>{(item.probability * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          <WheelProofBanner />

          {/* Spin History */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">Spin History</h3>
            {spinHistory.length > 0 ? (
              <div
                className="space-y-3.5 max-h-[200px] overflow-y-auto text-[13px] pr-6 [&::-webkit-scrollbar]:w-[10px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3a3a3a] [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {spinHistory.slice(0, 10).map((spin) => (
                  <a
                    key={spin.id}
                    href={`/spin-proof/${spin.spinId}`}
                    className="flex justify-between items-center hover:bg-white/5 rounded -mx-2 px-2 py-0.5 group"
                    title="View proof"
                  >
                    <span className="text-white">{spin.date}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium" style={{ color: getPrizeColor(spin.result) }}>
                        {getPrizeLabel(spin.result)}
                      </span>
                      <span className="text-white/30 group-hover:text-banana text-[10px]">↗</span>
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[#636366] text-center text-[13px] py-2">No spins yet</p>
            )}
          </div>
        </div>
      </div>

      {/* How to Earn Spins */}
      <section id="earn-spins" className="mt-12 scroll-mt-24">
        <h2 className="text-xl font-semibold text-text-primary mb-4">How to Earn Spins</h2>
        <PromoCarousel
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
