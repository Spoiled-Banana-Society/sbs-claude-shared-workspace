'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LIVE_ACTIVITY_ENABLED,
  LIVE_ACTIVITY_STALE_MS,
  LIVE_ACTIVITY_STALE_CHECK_MS,
  LIVE_ACTIVITY_ZERO_LINGER_MS,
} from '@/lib/liveActivity';

/**
 * Subscribes to the single live draft-activity summary node and returns the
 * display-ready { count, round }, or null when there's nothing to show.
 *
 * Returns null (line hidden) when ANY of:
 *   - the feature flag is off,
 *   - Firebase isn't configured,
 *   - no value / a malformed value,
 *   - STALE: the aggregator hasn't provably written within LIVE_ACTIVITY_STALE_MS
 *     (fail-closed — a dead/stalled aggregator hides the line instead of
 *     freezing a number),
 *   - count < 1 or round < 1 that PERSISTS past LIVE_ACTIVITY_ZERO_LINGER_MS
 *     (one flaky aggregator tick undercounting must not blink the line out).
 *
 * Freshness is judged by the value's own server `updatedAt` stamp, never by
 * when this client received it: RTDB replays the last stored value the moment
 * we subscribe, so an hours-stale node would otherwise look "fresh" on every
 * mount and the line would flash in, then drop 45s later — on every page visit.
 * A MOVED updatedAt between events is clock-skew-proof evidence of a live
 * aggregator; only the first event has to fall back to comparing the stamp
 * against this device's clock (and a skewed clock merely delays the line by
 * one ~10s tick, until the delta path proves liveness).
 *
 * Safety: this subscribes to ONE tiny RTDB node with stable (empty) effect deps
 * and cleans up on unmount. It performs NO fetch — it can't contribute to the
 * render-loop/self-DDoS class of bug. The only timer is a cheap clock-comparison
 * interval for staleness (no network).
 */
export function useLiveDraftActivity(): { count: number; round: number } | null {
  const [value, setValue] = useState<{ count: number; round: number } | null>(null);
  // Client time we last PROVED the aggregator alive (see freshness note above).
  const freshAtRef = useRef<number>(0);
  // Last server stamp seen; 0 = no event yet, -1 = event with a missing stamp.
  const lastStampRef = useRef<number>(0);
  // Client time a fresh zero-count first arrived (0 = currently non-zero).
  const zeroSinceRef = useRef<number>(0);
  // Bump to re-evaluate the render-time checks without touching the value.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!LIVE_ACTIVITY_ENABLED) return;
    // Source switched 2026-08-18 from the Go aggregator's RTDB node (which
    // stuck at count:0 while a fast draft was live) to our own computed
    // endpoint /api/drafts/live-activity (RecentFills → per-draft RTDB state).
    // Same freshness / zero-linger semantics as before.
    let cancelled = false;
    const apply = (v: { count: number; round: number; updatedAt: number } | null) => {
      const now = Date.now();
      if (!v) {
        lastStampRef.current = 0;
        zeroSinceRef.current = 0;
        setValue(null);
        return;
      }
      freshAtRef.current = now;
      lastStampRef.current = v.updatedAt || -1;
      if (v.count >= 1 && v.round >= 1) {
        zeroSinceRef.current = 0;
        setValue({ count: v.count, round: v.round });
      } else {
        if (!zeroSinceRef.current) zeroSinceRef.current = now;
        setTick((n) => n + 1);
      }
    };
    const poll = async () => {
      try {
        const res = await fetch('/api/drafts/live-activity', { cache: 'no-store' });
        if (!res.ok) return;
        const j = (await res.json()) as { count?: number; round?: number; updatedAt?: number };
        if (cancelled) return;
        apply({ count: Number(j.count ?? 0), round: Number(j.round ?? 0), updatedAt: Number(j.updatedAt ?? Date.now()) });
      } catch { /* keep last value; staleness check hides it if this persists */ }
    };
    void poll();
    const pollTimer = setInterval(() => { void poll(); }, 10_000);
    const staleTimer = setInterval(() => {
      setTick((n) => n + 1);
    }, LIVE_ACTIVITY_STALE_CHECK_MS);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(staleTimer);
    };
  }, []);

  if (!LIVE_ACTIVITY_ENABLED) return null;
  if (!value) return null;
  // Fail-closed: hide unless the aggregator provably wrote recently.
  if (Date.now() - freshAtRef.current > LIVE_ACTIVITY_STALE_MS) return null;
  // A zero that outlived the linger is a real "nothing going".
  if (zeroSinceRef.current && Date.now() - zeroSinceRef.current > LIVE_ACTIVITY_ZERO_LINGER_MS) {
    return null;
  }
  return value;
}
