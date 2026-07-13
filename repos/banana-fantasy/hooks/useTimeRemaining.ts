'use client';

import { useEffect, useState } from 'react';
import {
  isSlowDraftPickLength,
  slowDraftActiveSecondsUntil,
} from '@/utils/slowDraftClock';

/**
 * Custom hook to calculate remaining time from timestamps.
 *
 * Calculates time remaining based on:
 * - Draft start countdown: if draft hasn't started yet (now < draftStartTime)
 * - Turn timer: if turn is active (endOfTurnTimestamp is set and draft has started)
 *
 * For slow drafts (pickLengthSec >= 1h) the turn timer counts only the active
 * window (05:00–22:00 PT) — it shows the true pick length (e.g. 8:00:00) and
 * freezes during the overnight pause, instead of the raw wall-clock difference
 * which would read ~18h because it includes the paused hours.
 *
 * Updates every 100ms for smooth display and accurate logic checks.
 *
 * @param endOfTurnTimestamp - Unix timestamp in SECONDS when the current turn ends
 * @param draftStartTime - Unix timestamp in SECONDS when the draft starts (optional)
 * @param pickLengthSec - Pick length in seconds; when it's a slow-draft length the
 *                        countdown uses the active-window clock (optional)
 * @returns Time remaining in seconds, or null if no timestamps available
 */
export function useTimeRemaining(
  endOfTurnTimestamp: number | null | undefined,
  draftStartTime: number | null | undefined,
  pickLengthSec?: number | null,
): number | null {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => {
    const isSlow = isSlowDraftPickLength(pickLengthSec ?? 0);

    const updateTimer = () => {
      const now = Date.now();

      // Check if the draft has started
      if (draftStartTime && now < draftStartTime * 1000) {
        // Countdown to draft start (always wall-clock — the pause doesn't apply pre-draft)
        const remaining = draftStartTime * 1000 - now;
        setTimeRemaining(Math.max(0, Math.floor(remaining / 1000)));
      } else if (endOfTurnTimestamp) {
        // Countdown for turn timer
        if (isSlow) {
          // Active-window seconds remaining until the pick expires. Reads the
          // full pick length at the start, ticks down during active hours, and
          // freezes overnight (22:00–05:00 PT).
          const nowSec = Math.floor(now / 1000);
          setTimeRemaining(slowDraftActiveSecondsUntil(nowSec, endOfTurnTimestamp));
        } else {
          // endOfTurnTimestamp is in seconds (Unix timestamp), convert to milliseconds
          const timestampMs = endOfTurnTimestamp * 1000;
          const remaining = timestampMs - now;
          // CEIL (not floor): the pick window is exactly pickLength seconds
          // (pickEndTime = pickStart + pickLength). A fraction of a second has
          // already elapsed by first paint, so floor would immediately read
          // pickLength-1 (e.g. 29 for a 30s pick). Ceil shows the full clock —
          // 30, 29, … 1, 0 — each number for its whole second. The caller caps
          // to pickLength, so clock-skew can't make this read pickLength+1.
          setTimeRemaining(Math.max(0, Math.ceil(remaining / 1000)));
        }
      } else {
        // No timestamps available
        setTimeRemaining(null);
      }
    };

    // Update every 100ms for smooth display
    const timer = setInterval(updateTimer, 100);
    updateTimer(); // Initial call

    return () => {
      clearInterval(timer);
    };
  }, [endOfTurnTimestamp, draftStartTime, pickLengthSec]);

  return timeRemaining;
}
