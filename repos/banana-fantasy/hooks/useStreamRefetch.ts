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
    // JITTERED coalesce (2026-06-10): a ping fans out to EVERY open tab and
    // device at the same instant. With a fixed 300ms delay they all fired
    // their (sometimes token-refreshing) fetches in the same moment — and
    // concurrent single-use refresh-token rotation across tabs trips Privy's
    // reuse detection, revoking the whole session family (Boris's "bell
    // logged me out on Mac AND iPhone in the same second"). A random
    // 300-1800ms spread per tab keeps refetches near-real-time while making
    // a same-instant multi-tab auth stampede effectively impossible.
    const jitterMs = 300 + Math.random() * 1500;
    const coalesced = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; refetchRef.current(); }, jitterMs);
    };
    const unsub = subscribeUserEvents(wallet, coalesced);
    return () => {
      if (timer) clearTimeout(timer);
      try { unsub(); } catch { /* ignore */ }
    };
  }, [wallet]);
}
