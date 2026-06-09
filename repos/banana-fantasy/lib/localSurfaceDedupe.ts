'use client';

/**
 * Dedupe between OPTIMISTIC client-side surfaces and the real-time stream.
 *
 * The device that performs an action (buys passes, claims a promo) now fires
 * its toast/bell-refresh immediately from the API response — that's the only
 * way the feedback is instant on mobile, where the iOS-PWA RTDB socket is
 * often suspended. But on desktop the stream event for the same milestone
 * arrives ~100ms later and would double-toast. So: when a surface is shown
 * optimistically, mark its event type here; the stream listener skips the
 * toast for that type inside a short window (the bell entry is server-side
 * and dedupeKey'd, so only the toast needs this).
 *
 * Module-level map — both writers (buy flows / usePromos) and the reader
 * (useUserEventStream) live in the same client bundle.
 */

const DEDUPE_WINDOW_MS = 20_000;

const recent = new Map<string, number>();

/** Record that this event type's toast was just shown locally. */
export function markLocalSurface(type: string): void {
  recent.set(type, Date.now());
}

/** True if this event type's toast was shown locally within the window. */
export function wasRecentLocalSurface(type: string): boolean {
  const at = recent.get(type);
  if (!at) return false;
  if (Date.now() - at > DEDUPE_WINDOW_MS) {
    recent.delete(type);
    return false;
  }
  return true;
}

/**
 * Ask the notification bell to refetch right now (e.g. after the local user
 * claims a promo or completes a purchase, so the new entry is visible the
 * moment they open the bell — even on mobile where the poll is 5s).
 */
export function requestBellRefetch(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sbs-notifs-refetch'));
}
