/** Default pick length by speed when server pickLength is unavailable. */
export function expectedPickLengthFromSpeed(draftSpeed: 'fast' | 'slow'): number {
  return draftSpeed === 'fast' ? 30 : 28800;
}

/** Cap displayed countdown so backend +1s grace never shows pickLength+1. */
export function capDisplayTimeRemaining(
  remainingSeconds: number,
  pickLengthSec?: number | null,
): number {
  const raw = Math.max(0, Math.round(remainingSeconds));
  if (pickLengthSec != null && pickLengthSec > 0) {
    return Math.min(raw, pickLengthSec);
  }
  return raw;
}

/** True when remaining looks like a pre-sync default (near full pick length). */
export function looksLikeUnconfirmedTimerRemaining(
  remainingSeconds: number,
  expectedPickLengthSec: number,
): boolean {
  return remainingSeconds > expectedPickLengthSec * 0.98;
}
