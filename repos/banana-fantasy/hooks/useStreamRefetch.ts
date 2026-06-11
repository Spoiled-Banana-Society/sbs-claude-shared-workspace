'use client';

import { useEffect, useRef } from 'react';
import { subscribeUserEvents } from '@/lib/api/firebase';

/**
 * Coalesced "something changed — refetch" nudge from the user's RTDB event
 * stream. The server pings `userEvents/{wallet}` on every notification-worthy
 * action (purchase, sale, offer, friend request, prize, claim…), so any hook
 * that polls can ALSO refresh within ~300ms of the event instead of waiting
 * out its poll interval. Keep the poll as the fallback — this is additive.
 *
 * Render-loop safety (CLAUDE.md Rule #0): the effect depends ONLY on the
 * wallet scalar; the refetch callback lives in a ref so identity churn from
 * the caller (Privy/auth re-renders) never tears down the subscription.
 *
 * Coalescing: one refetch per ~300ms burst, same pattern as the bell + promos
 * subscriptions — a ping flood (iOS reconnect replays up to 15 events) still
 * costs a single request.
 */
export function useStreamRefetch(
  wallet: string | null | undefined,
  refetch: () => void,
): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!wallet) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const coalesced = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; refetchRef.current(); }, 300);
    };
    const unsub = subscribeUserEvents(wallet, coalesced);
    return () => {
      if (timer) clearTimeout(timer);
      try { unsub(); } catch { /* ignore */ }
    };
  }, [wallet]);
}
