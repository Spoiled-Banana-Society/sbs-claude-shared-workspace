'use client';

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
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
import { allKnownSegmentsById, type WheelSegment } from '@/lib/wheelConfig';
import { useWheelSegments } from '@/hooks/useWheelSegments';
import { SPIN_DURATION_MS } from '@/components/wheel/BananaWheel';
import { useQueryClient } from '@tanstack/react-query';

export default function BananaWheelPage() {
  const { user, updateUser, isLoading, isBalanceLoaded, refreshBalance, refreshBalanceUntil, freezeSpinReveal } = useAuth();
  const spinMutation = useSpin(user?.id);
  const queryClient = useQueryClient();
  const promosQuery = usePromos({ userId: user?.id });
  const [queuedJP, setQueuedJP] = React.useState(0);
  const [queuedHOF, setQueuedHOF] = React.useState(0);
  const [queuedJackHOF, setQueuedJackHOF] = React.useState(0);

  // A JP/HOF spin win just landed: poll the live queue until the winner's seat
  // appears, then feed the win modal a live "X/10" + a Join-the-Lobby URL and
  // fire the bell notification with the real remaining count. The seat is
  // created server-side AFTER the spin response (waitUntil), so it typically
  // resolves a few seconds after the wheel stops.
  const [specialWin, setSpecialWin] = React.useState<{ kind: 'jackpot' | 'hof' | 'jackhof'; spinId: string | null; startedAt: number } | null>(null);
  const [specialDraftStatus, setSpecialDraftStatus] = React.useState<{ count: number; draftRoomUrl: string | null } | null>(null);
  // Wheel prize odds now live behind the "i" by the title (not a big discouraging
  // panel on the page). Transparent (one tap), framed as "every spin wins".
  const [showOdds, setShowOdds] = React.useState(false);
  // Friendly "we're getting your prize ready" popup for when a won prize's
  // delivery needed retries (or got stuck). No web3 wording is shown — see
  // /api/wheel/pending-delivery.
  const [delivery, setDelivery] = React.useState<'pending' | 'stuck' | null>(null);
  const deliveryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingDismissedRef = useRef(false);
  const watchRef = useRef<() => void>(() => {});
  const specialWalletAddr = (user?.walletAddress || user?.id || '').toLowerCase();
  React.useEffect(() => {
    if (!specialWin || !specialWalletAddr) return;
    let cancelled = false;
    let notified = false;
    const { kind, spinId, startedAt } = specialWin;
    const label = kind === 'jackpot' ? 'Jackpot' : kind === 'hof' ? 'HOF' : 'JackHOF';
    const notify = (count: number | null) => {
      if (notified || cancelled) return;
      notified = true;
      const remaining = count !== null ? Math.max(0, 10 - count) : null;
      pushNotification({
        type: kind === 'jackpot' ? 'jackpot_queue' : kind === 'hof' ? 'hof_queue' : 'jackhof_queue',
        title: `You won a ${label} Draft (from the Wheel)!`,
        message: (remaining === null
          ? `You're in a ${label}-only lobby. It drafts as soon as 10 wheel winners are in (Slow Draft, 8 hrs/pick).`
          : remaining === 0
            ? `Your ${label} lobby is full (10/10) — your draft is starting now! (Slow Draft, 8 hrs/pick).`
            : `You're in a ${label}-only lobby (${count}/10) — ${remaining} more wheel winner${remaining === 1 ? '' : 's'} to go, then you draft (Slow Draft, 8 hrs/pick).`)
          + (kind === 'jackpot' ? ' Win your league → skip to the Finals.' : kind === 'hof' ? ' Win your league → enter the HOF playoffs.' : ' Win your league → skip to the Finals AND enter the HOF playoffs.'),
        link: '/drafting',
        ...(spinId ? { dedupeKey: `spin-win-${spinId}` } : {}),
      });
      // A few seconds AFTER the congrats bell, a reminder to make sure Draft
      // Alerts are on — JP/HOF wheel drafts are slow (8 hrs/pick), so missing
      // the start or a pick is costly. Sent to everyone (neutral "make sure"
      // copy reads fine whether they're already on or off); deduped per spin so
      // it fires once. pushNotification persists server-side + renders locally.
      setTimeout(() => {
        if (cancelled) return;
        pushNotification({
          type: kind === 'jackpot' ? 'jackpot_queue' : kind === 'hof' ? 'hof_queue' : 'jackhof_queue',
          title: 'Make sure your Draft Alerts are on',
          message: `Your ${label} Draft (from the Wheel) is a slow draft (8 hrs/pick) — turn on Draft Alerts so you don't miss the start or a pick.`,
          link: '/profile?tab=notifications',
          icon: '🔔',
          ...(spinId ? { dedupeKey: `spin-alerts-${spinId}` } : {}),
        });
      }, 6000);
    };
    const poll = () => {
      fetchJson<Record<string, { rounds?: Array<{ roundId: number; status: string; draftId?: string | null; members: Array<{ wallet: string }> }> }>>('/api/queues')
        .then(queues => {
          if (cancelled) return;
          const rounds = (queues[kind]?.rounds || [])
            .filter(r => (r.status === 'filling' || r.status === 'drafting')
              && r.members.some(m => (m.wallet || '').toLowerCase() === specialWalletAddr))
            .sort((a, b) => b.roundId - a.roundId);
          const round = rounds[0];
          if (!round) return;
          const count = round.members.length;
          const params = new URLSearchParams({
            id: round.draftId || `queue-${kind}-${round.roundId}`,
            name: 'Draft Room',
            speed: 'slow',
            players: String(count),
          });
          if (user?.walletAddress) {
            params.set('mode', 'live');
            params.set('wallet', user.walletAddress);
          }
          params.set('specialType', kind);
          setSpecialDraftStatus({ count, draftRoomUrl: `/draft-room?${params.toString()}` });
          notify(count);
        })
        .catch(() => { /* next tick retries; the 20s fallback noti covers a dead poll */ });
    };
    poll();
    const iv = setInterval(() => {
      if (Date.now() - startedAt > 120_000) { clearInterval(iv); return; }
      poll();
    }, 2_500);
    // The win must ALWAYS ring the bell — if the seat hasn't resolved in 20s
    // (slow mint), fire the generic copy; dedupeKey keeps it single.
    const fallback = setTimeout(() => notify(null), 20_000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(fallback); };
    // user?.walletAddress intentionally read via specialWalletAddr (stable scalar) — Rule #0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialWin, specialWalletAddr]);
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
        setQueuedJackHOF(countQueued('jackhof'));
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
    let jackhof = 0;
    for (const s of spinHistory) {
      const p = s.prize;
      if (p && typeof p === 'object' && p.type) {
        if (p.type === 'draft_pass' && typeof p.value === 'number') drafts += p.value;
        else if (p.type === 'custom' && p.value === 'jackpot') jackpot += 1;
        else if (p.type === 'custom' && p.value === 'hof') hof += 1;
        else if (p.type === 'custom' && p.value === 'jackhof') jackhof += 1;
        continue;
      }
      const r = s.result || '';
      if (r.startsWith('jackhof')) jackhof += 1;
      else if (r.startsWith('jackpot')) jackpot += 1;
      else if (r.startsWith('hof')) hof += 1;
      else {
        const m = r.match(/^draft-(\d+)/);
        if (m) drafts += Number(m[1]);
      }
    }
    return { drafts, jackpot, hof, jackhof };
  }, [spinHistory]);

  const spinsAvailable = Math.max(0, user?.wheelSpins ?? 0);

  // Active-period wedge set (falls back to the static classic config).
  const { segments: activeSegments } = useWheelSegments();
  // History rows can reference wedge ids from OLDER config generations —
  // resolve against every id that has ever existed, current set winning.
  const segmentMap = useMemo(() => {
    const map = new Map(allKnownSegmentsById);
    for (const segment of activeSegments) map.set(segment.id, segment);
    return map;
  }, [activeSegments]);

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
    // A fresh spin invalidates any previous JP/HOF seat poll/modal state.
    setSpecialWin(null);
    setSpecialDraftStatus(null);
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
      // Any win that delivers a prize on-chain: start watching for a delayed
      // delivery so we can reassure the user if it needs retries.
      const isDeliverableWin =
        (segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number' && segment.prizeValue > 0) ||
        (segment.prizeType === 'custom' && (segment.prizeValue === 'jackpot' || segment.prizeValue === 'hof' || segment.prizeValue === 'jackhof'));
      if (isDeliverableWin) watchRef.current();
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
          // 'gift' = a FREE draft (won/earned), distinct from a PURCHASED pass
          // ('ticket'). Same icon for every free-draft notification (wheel win
          // + card-fee credit) so "free draft" always reads the same (Boris).
          icon: 'gift',
          // Stable key → idempotent server doc AND the instant local bell
          // insert in pushNotification (entry shows the ms the wheel stops).
          ...(_outcome?.spinId ? { dedupeKey: `spin-win-${_outcome.spinId}` } : {}),
        });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        updateUser({ jackpotEntries: (user.jackpotEntries || 0) + 1 });
        // Bell noti fires from the seat poll (with the live X/10 count) — see
        // the specialWin effect; a 20s fallback guarantees it always rings.
        setSpecialDraftStatus(null);
        setSpecialWin({ kind: 'jackpot', spinId: _outcome?.spinId ?? null, startedAt: Date.now() });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        updateUser({ hofEntries: (user.hofEntries || 0) + 1 });
        setSpecialDraftStatus(null);
        setSpecialWin({ kind: 'hof', spinId: _outcome?.spinId ?? null, startedAt: Date.now() });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackhof') {
        updateUser({ jackhofEntries: (user.jackhofEntries || 0) + 1 });
        setSpecialDraftStatus(null);
        setSpecialWin({ kind: 'jackhof', spinId: _outcome?.spinId ?? null, startedAt: Date.now() });
      }
    },
    [updateUser, user, refreshBalance, refreshBalanceUntil, queryClient],
  );

  // ── Delayed-prize delivery watch ────────────────────────────────────────
  // Polls /api/wheel/pending-delivery so a prize whose delivery needed retries
  // shows a reassuring popup instead of silently missing.
  const pollDeliveryOnce = useCallback(async (): Promise<'pending' | 'stuck' | 'none'> => {
    const w = (user?.walletAddress || user?.id || '').toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return 'none';
    try {
      const res = await fetchJson<{ status: 'pending' | 'stuck' | 'none' }>(
        `/api/wheel/pending-delivery?wallet=${w}`,
      );
      return res?.status ?? 'none';
    } catch {
      return 'none';
    }
  }, [user?.walletAddress, user?.id]);

  const watchDelivery = useCallback(() => {
    if (deliveryTimerRef.current) clearInterval(deliveryTimerRef.current);
    pendingDismissedRef.current = false;
    let ticks = 0;
    let sawPending = false;
    const stop = () => {
      if (deliveryTimerRef.current) clearInterval(deliveryTimerRef.current);
      deliveryTimerRef.current = null;
    };
    const tick = async () => {
      ticks += 1;
      const status = await pollDeliveryOnce();
      if (status === 'pending') {
        sawPending = true;
        if (!pendingDismissedRef.current) setDelivery('pending');
      } else if (status === 'stuck') {
        setDelivery('stuck'); // always surface — auto-recovery gave up
        stop();
        return;
      } else if (sawPending) {
        setDelivery(null); // was pending, now delivered
        stop();
        return;
      }
      if (ticks >= 15) stop(); // ~60s window
    };
    void tick();
    deliveryTimerRef.current = setInterval(() => { void tick(); }, 4000);
  }, [pollDeliveryOnce]);

  // Keep the ref that handleSpinComplete calls pointed at the latest watcher.
  useEffect(() => { watchRef.current = watchDelivery; }, [watchDelivery]);
  // Clean up the poll timer on unmount.
  useEffect(() => () => { if (deliveryTimerRef.current) clearInterval(deliveryTimerRef.current); }, []);

  // On load / wallet ready: if a prize is already mid-delivery (e.g. the user
  // reloaded), reflect it. Rule #0: deps are a stable scalar; the watcher is
  // reached via ref, not the dep array.
  const mountCheckRef = useRef(pollDeliveryOnce);
  useEffect(() => { mountCheckRef.current = pollDeliveryOnce; }, [pollDeliveryOnce]);
  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(specialWalletAddr)) return;
    void (async () => {
      const status = await mountCheckRef.current();
      if (status === 'pending') { setDelivery('pending'); watchRef.current(); }
      else if (status === 'stuck') setDelivery('stuck');
    })();
  }, [specialWalletAddr]);

  const prizeSummary = useMemo(() => {
    const summary = new Map<string, { label: string; color: string; probability: number }>();
    for (const segment of activeSegments) {
      const key = `${segment.prizeType}:${segment.prizeValue ?? ''}:${segment.label}`;
      const existing = summary.get(key);
      if (existing) {
        existing.probability += segment.probability;
      } else {
        summary.set(key, { label: segment.label, color: segment.color, probability: segment.probability });
      }
    }
    return Array.from(summary.values()).sort((a, b) => b.probability - a.probability);
  }, [activeSegments]);

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
          <p className="text-white text-[14px]">Spin to win Free Drafts and Jackpot, HOF & JackHOF Entries</p>
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
        <div className="flex items-center justify-center gap-2 mb-1">
          <h1 className="text-[28px] font-semibold text-white tracking-tight">Banana Wheel</h1>
          <button
            type="button"
            onClick={() => setShowOdds(true)}
            aria-label="Prize odds"
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </div>
        <p className="text-white text-[14px]">Spin to win Free Drafts and Jackpot, HOF & JackHOF Entries</p>
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
          {/* Prizes on Wheel moved into the "i" popover by the title (Boris 2026-06-20). */}

          {/* What Are These? — hugs its content (no forced stretch; the wheel+Spin
              center column is taller than the right column, so stretching here just
              created empty space — Boris 2026-06-20). */}
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
                  Land on Jackpot and you&apos;re placed into a Jackpot draft lobby. Draft starts when 10 wheel winners join. Win that league and skip straight to the finals.
                </p>
                <p className="text-white/40 mt-1 leading-relaxed text-[12px]">
                  Slow draft (8h per pick) · Seat locked · Sellable on the Marketplace until the draft fills
                </p>
              </div>
              <div>
                <span className="text-[#ffd60a] font-bold text-[15px]">HOF</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Land on HOF and you&apos;re placed into a HOF draft lobby. Draft starts when 10 wheel winners join. Compete for bonus prizes on top of regular rewards.
                </p>
                <p className="text-white/40 mt-1 leading-relaxed text-[12px]">
                  Slow draft (8h per pick) · Seat locked · Sellable on the Marketplace until the draft fills
                </p>
              </div>
              <div>
                <span className="font-bold text-[15px]"><span className="text-[#ff6b6b]">Jack</span><span className="text-[#ffd60a]">HOF</span></span>
                <p className="text-white mt-1.5 leading-relaxed">
                  The 0.1% wedge — the rarest prize on the wheel. Land it and you&apos;re placed into a JackHOF draft lobby with BOTH perks: win that league and you skip straight to the finals AND compete for HOF bonus prizes.
                </p>
                <p className="text-white/40 mt-1 leading-relaxed text-[12px]">
                  Slow draft (8h per pick) · Seat locked · Sellable on the Marketplace until the draft fills
                </p>
              </div>
              <div>
                <span className="text-[#32d74b] font-bold text-[15px]">Free Drafts</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Free drafts can only be used to draft. They cannot be used for promos — that includes Jackpot, HOF, and JackHOF drafts won on the Wheel.
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
            specialDraftStatus={specialDraftStatus}
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
            {/* Total spins done — count of the user's full spin history, inline
                in parens (Boris 2026-07-23). */}
            <h3 className="text-[16px] font-semibold text-white tracking-tight">
              My Winnings{' '}
              <span className="text-white/45 text-[13px] font-medium tabular-nums">
                ({spinHistory.length} Total {spinHistory.length === 1 ? 'Spin' : 'Spins'})
              </span>
            </h3>

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
              <div className="flex justify-between items-baseline">
                <span className="text-white text-[14px] font-medium">JackHOF</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[#ef6c37] font-semibold text-[16px] tabular-nums">{wonTotals.jackhof}</span>
                  <span className="text-white/35 text-[12px] tabular-nums">won · {(user?.jackhofEntries || 0) + queuedJackHOF} left</span>
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

      {/* Prize-odds popover (opened by the "i" next to the title). Transparent
          odds, one tap, framed as "every spin wins". */}
      {showOdds && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowOdds(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: 'rgba(20,20,20,0.96)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[17px] font-semibold text-white tracking-tight">Prizes on Wheel</h3>
              <button type="button" onClick={() => setShowOdds(false)} aria-label="Close" className="text-white/40 hover:text-white transition-colors text-[20px] leading-none">×</button>
            </div>
            <div className="space-y-3.5 text-[14px]">
              {prizeSummary.map((item) => (
                <div key={`${item.label}-${item.probability}`} className="flex justify-between items-baseline">
                  <span className="font-semibold" style={{ color: item.color }}>{item.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: item.color }}>{(item.probability * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delayed-prize delivery popup. Reassures the user when a won prize is
          taking a moment to arrive (or, rarely, got stuck and a human's on it).
          Deliberately NO web3 wording. */}
      {delivery && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-sm rounded-2xl p-6 text-center"
            style={{ background: 'rgba(20,20,20,0.96)', border: '1px solid rgba(251,191,36,0.25)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}
          >
            <div className="text-4xl mb-3">🍌</div>
            {delivery === 'pending' ? (
              <>
                <div className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-banana/30 border-t-banana animate-spin" />
                <h3 className="text-[17px] font-semibold text-white tracking-tight mb-2">Getting your prize ready…</h3>
                <p className="text-[14px] text-white/70 leading-relaxed mb-5">
                  Hang tight — this can take a minute. You don&apos;t need to do anything; your prize will show up automatically.
                </p>
                <button
                  type="button"
                  onClick={() => { pendingDismissedRef.current = true; setDelivery(null); }}
                  className="w-full rounded-xl py-2.5 text-[15px] font-semibold text-black"
                  style={{ background: '#fbbf24' }}
                >
                  Got it
                </button>
              </>
            ) : (
              <>
                <h3 className="text-[17px] font-semibold text-white tracking-tight mb-2">We&apos;re on it</h3>
                <p className="text-[14px] text-white/70 leading-relaxed mb-5">
                  Your prize is taking longer than usual to arrive. Don&apos;t worry — our team has been alerted and will make sure you get it. Nothing needed on your end.
                </p>
                <button
                  type="button"
                  onClick={() => setDelivery(null)}
                  className="w-full rounded-xl py-2.5 text-[15px] font-semibold text-black"
                  style={{ background: '#fbbf24' }}
                >
                  Got it
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
