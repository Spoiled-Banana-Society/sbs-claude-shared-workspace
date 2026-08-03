'use client';

import { useEffect, useState } from 'react';
import { clientLog } from '@/lib/clientLog';

const SLOT_ID_RE = /^\d{4}-(fast|slow)-draft-\d+$/;

// Module-level cache + pub/sub. Slot → league mapping is immutable once
// a draft is assigned, so cached values never need invalidation — but
// they DO need to be updatable from outside (the RTDB displayName push
// in useDraftingPageState / app/draft-room/page.tsx). Without pub/sub,
// the hook reads the cache once on mount and ignores later updates —
// which is exactly why "live league #" updates required a hard refresh.
const cache = new Map<string, number>();
const listenersBySlot = new Map<string, Set<() => void>>();
// Tracks slots currently running a REST retry loop, so multiple
// component mounts for the same slot don't each spin up their own loop.
const retryInFlight = new Set<string>();

function notify(slotId: string) {
  const set = listenersBySlot.get(slotId);
  if (set) for (const cb of set) cb();
}

/**
 * Push a league number into the cache from outside (e.g. when an RTDB
 * displayName event arrives). All mounted `useLeagueNumberForSlot`
 * hooks for that slot re-render immediately.
 */
export function setLeagueNumberInCache(slotId: string, leagueNumber: number) {
  if (!slotId || !Number.isFinite(leagueNumber) || leagueNumber <= 0) {
    clientLog('league#', 'cache.set.invalid', { slotId, leagueNumber });
    return;
  }
  const prev = cache.get(slotId);
  if (prev === leagueNumber) {
    // Deliberately silent. The lobby re-pushes every draft's league # on
    // every poll, so for a user with N drafts this branch is hit N times
    // per poll cycle forever — it was 86% of all client logging on the
    // site and the top driver of the console-retention leak documented in
    // lib/clientLog.ts. "Nothing changed" is not worth a log line.
    return;
  }
  cache.set(slotId, leagueNumber);
  const listenerCount = listenersBySlot.get(slotId)?.size ?? 0;
  clientLog('league#', 'cache.set', { slotId, leagueNumber, prev, listeners: listenerCount });
  notify(slotId);
}

// Internal cache-set used by REST path — same effect, different tag.
function cacheFromRest(slotId: string, n: number) {
  cache.set(slotId, n);
  clientLog('league#', 'rest.fetch.ok', { slotId, n, listeners: listenersBySlot.get(slotId)?.size ?? 0 });
  notify(slotId);
}

/**
 * Resolves a draft slot id (e.g. `2024-fast-draft-802`) to its global
 * league number (e.g. 803) via /api/drafts/{slotId}/league-number.
 *
 * The slot id counter (per-speed-per-year) drifts from the global
 * FilledLeaguesCount over time. The doc's DisplayName field is the
 * source of truth.
 *
 * Real-time updates: RTDB push subscribers (useDraftingPageState,
 * app/draft-room/page.tsx) call setLeagueNumberInCache(slot, n) when
 * the Go API writes drafts/{id}/displayName to RTDB at fill. Mounted
 * hooks re-render via the pub/sub on listenersBySlot.
 */
export function useLeagueNumberForSlot(slotId: string | undefined): number | null {
  const initial = slotId ? cache.get(slotId) ?? null : null;
  const [leagueNumber, setLeagueNumber] = useState<number | null>(initial);

  // Re-read the cache whenever it changes for this slotId (pub/sub).
  // Triggered by setLeagueNumberInCache from the RTDB push subscribers.
  useEffect(() => {
    if (!slotId) return;
    const cb = () => {
      const v = cache.get(slotId);
      if (v != null) {
        clientLog('league#', 'hook.update', { slotId, n: v });
        setLeagueNumber(v);
      }
    };
    let set = listenersBySlot.get(slotId);
    if (!set) {
      set = new Set();
      listenersBySlot.set(slotId, set);
    }
    set.add(cb);
    clientLog('league#', 'hook.subscribe', { slotId, totalListeners: set.size });
    // Pick up any value that landed between mount and subscribe.
    cb();
    return () => {
      set!.delete(cb);
      if (set!.size === 0) listenersBySlot.delete(slotId);
      clientLog('league#', 'hook.unsubscribe', { slotId, remaining: set?.size ?? 0 });
    };
  }, [slotId]);

  // REST fallback with exponential backoff retry. Belt-and-suspenders
  // alongside the RTDB push primary path:
  //  - If push delivers first, our cache check at the top short-circuits
  //    and we never make a REST call.
  //  - If push hasn't delivered (initial 404 from Firestore race, or
  //    push subscription broken / RTDB outage / network blip), we keep
  //    retrying with 500ms → 1s → 2s → 4s cap until success or unmount.
  //  - The `fallback.won` telemetry event fires when REST succeeds AFTER
  //    push had a fair chance to deliver (>1s post-mount or attempt > 0).
  //    Watching that counter rise = push system degrading silently.
  useEffect(() => {
    if (!slotId || !SLOT_ID_RE.test(slotId)) {
      setLeagueNumber(null);
      return;
    }
    const cached = cache.get(slotId);
    if (cached) {
      setLeagueNumber(cached);
      return;
    }
    // Another mount of this slot is already running a retry loop — let
    // it populate the cache, our pub/sub from the OTHER useEffect above
    // will catch the update.
    if (retryInFlight.has(slotId)) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const mountTime = Date.now();
    retryInFlight.add(slotId);

    const tryFetch = async (): Promise<void> => {
      if (cancelled) { retryInFlight.delete(slotId); return; }
      // Push may have populated the cache between attempts → no need to fetch.
      if (cache.get(slotId) != null) { retryInFlight.delete(slotId); return; }

      try {
        clientLog('league#', 'rest.fetch.start', { slotId, attempt });
        const res = await fetch(`/api/drafts/${slotId}/league-number`);
        if (cancelled) { retryInFlight.delete(slotId); return; }
        // Push may have delivered while our fetch was in flight.
        if (cache.get(slotId) != null) { retryInFlight.delete(slotId); return; }
        if (res.ok) {
          const body = (await res.json()) as { leagueNumber?: number };
          if (typeof body.leagueNumber === 'number') {
            cacheFromRest(slotId, body.leagueNumber);
            setLeagueNumber(body.leagueNumber);
            // Telemetry: did push fail us? attempt > 0 means we
            // retried (initial REST got 404). msSinceMount > 1s means
            // push had a fair chance to deliver and didn't. Either is
            // a signal that the push path isn't keeping up.
            const msSinceMount = Date.now() - mountTime;
            if (attempt > 0 || msSinceMount > 1000) {
              clientLog('league#', 'fallback.won', {
                slotId,
                n: body.leagueNumber,
                attempt,
                msSinceMount,
              });
            }
            retryInFlight.delete(slotId);
            return;
          }
          clientLog('league#', 'rest.fetch.bad-body', { slotId, attempt, body });
        } else {
          clientLog('league#', 'rest.fetch.not-ok', { slotId, attempt, status: res.status });
        }
      } catch (err) {
        clientLog('league#', 'rest.fetch.error', { slotId, attempt, err: String(err) });
      }

      // Schedule next retry with exponential backoff, capped at 4s.
      if (cancelled) { retryInFlight.delete(slotId); return; }
      const delay = Math.min(4000, 500 * Math.pow(2, attempt));
      attempt += 1;
      retryTimer = setTimeout(() => { void tryFetch(); }, delay);
    };
    void tryFetch();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryInFlight.delete(slotId);
    };
  }, [slotId]);

  return leagueNumber;
}
