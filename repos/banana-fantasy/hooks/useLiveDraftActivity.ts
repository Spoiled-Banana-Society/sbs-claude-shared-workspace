'use client';

import { useEffect, useRef, useState } from 'react';
import { isFirebaseAvailable, subscribeLiveDraftActivity } from '@/lib/api/firebase';
import {
  LIVE_ACTIVITY_ENABLED,
  LIVE_ACTIVITY_STALE_MS,
  LIVE_ACTIVITY_STALE_CHECK_MS,
} from '@/lib/liveActivity';

/**
 * Subscribes to the single live draft-activity summary node and returns the
 * display-ready { count, round }, or null when there's nothing to show.
 *
 * Returns null (line hidden) when ANY of:
 *   - the feature flag is off,
 *   - Firebase isn't configured,
 *   - no value / a malformed value,
 *   - count < 1 (zero in-progress fast drafts),
 *   - round < 1 (no valid furthest round),
 *   - STALE: no fresh write received within LIVE_ACTIVITY_STALE_MS (fail-closed —
 *     a dead/stalled aggregator hides the line instead of freezing a number).
 *
 * Safety: this subscribes to ONE tiny RTDB node with stable (empty) effect deps
 * and cleans up on unmount. It performs NO fetch — it can't contribute to the
 * render-loop/self-DDoS class of bug. The only timer is a cheap clock-comparison
 * interval for staleness (no network).
 */
export function useLiveDraftActivity(): { count: number; round: number } | null {
  const [value, setValue] = useState<{ count: number; round: number } | null>(null);
  const receivedAtRef = useRef<number>(0);
  // Bump to re-evaluate staleness on an interval without touching the value.
  const [, setStaleTick] = useState(0);

  useEffect(() => {
    if (!LIVE_ACTIVITY_ENABLED) return;
    if (!isFirebaseAvailable()) return;

    const unsub = subscribeLiveDraftActivity((v) => {
      receivedAtRef.current = Date.now();
      if (v && v.count >= 1 && v.round >= 1) {
        setValue({ count: v.count, round: v.round });
      } else {
        // Fresh write, but nothing to show (0 drafts) — clear the line.
        setValue(null);
      }
    });

    const staleTimer = setInterval(() => {
      setStaleTick((n) => n + 1);
    }, LIVE_ACTIVITY_STALE_CHECK_MS);

    return () => {
      unsub();
      clearInterval(staleTimer);
    };
  }, []);

  if (!LIVE_ACTIVITY_ENABLED) return null;
  if (!value) return null;
  // Fail-closed: hide if we haven't heard a fresh write recently.
  if (Date.now() - receivedAtRef.current > LIVE_ACTIVITY_STALE_MS) return null;
  return value;
}
