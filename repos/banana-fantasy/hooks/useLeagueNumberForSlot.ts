'use client';

import { useEffect, useState } from 'react';

const SLOT_ID_RE = /^\d{4}-(fast|slow)-draft-\d+$/;

// Module-level cache + pub/sub. Slot → league mapping is immutable once
// a draft is assigned, so cached values never need invalidation — but
// they DO need to be updatable from outside (the RTDB displayName push
// in useDraftingPageState / app/draft-room/page.tsx). Without pub/sub,
// the hook reads the cache once on mount and ignores later updates —
// which is exactly why "live league #" updates required a hard refresh.
const cache = new Map<string, number>();
const listenersBySlot = new Map<string, Set<() => void>>();
const inFlight = new Map<string, Promise<number | null>>();

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
    console.info('[league#] cache.set.invalid', { slotId, leagueNumber });
    return;
  }
  const prev = cache.get(slotId);
  if (prev === leagueNumber) {
    console.info('[league#] cache.set.noop', { slotId, leagueNumber, prev });
    return;
  }
  cache.set(slotId, leagueNumber);
  const listenerCount = listenersBySlot.get(slotId)?.size ?? 0;
  console.info('[league#] cache.set', { slotId, leagueNumber, prev, listeners: listenerCount });
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
        console.info('[league#] hook.update', { slotId, n: v });
        setLeagueNumber(v);
      }
    };
    let set = listenersBySlot.get(slotId);
    if (!set) {
      set = new Set();
      listenersBySlot.set(slotId, set);
    }
    set.add(cb);
    console.info('[league#] hook.subscribe', { slotId, totalListeners: set.size });
    // Pick up any value that landed between mount and subscribe.
    cb();
    return () => {
      set!.delete(cb);
      if (set!.size === 0) listenersBySlot.delete(slotId);
      console.info('[league#] hook.unsubscribe', { slotId, remaining: set?.size ?? 0 });
    };
  }, [slotId]);

  // REST fallback. Fires once per slotId; once any source (push or REST)
  // populates the cache, this short-circuits on subsequent mounts.
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
    let cancelled = false;
    const promise = inFlight.get(slotId) ?? (async () => {
      try {
        console.info('[league#] rest.fetch.start', { slotId });
        const res = await fetch(`/api/drafts/${slotId}/league-number`);
        if (!res.ok) {
          console.info('[league#] rest.fetch.not-ok', { slotId, status: res.status });
          return null;
        }
        const body = (await res.json()) as { leagueNumber?: number };
        if (typeof body.leagueNumber === 'number') {
          cache.set(slotId, body.leagueNumber);
          console.info('[league#] rest.fetch.ok', { slotId, n: body.leagueNumber });
          notify(slotId);
          return body.leagueNumber;
        }
        console.info('[league#] rest.fetch.bad-body', { slotId, body });
        return null;
      } catch (err) {
        console.info('[league#] rest.fetch.error', { slotId, err: String(err) });
        return null;
      } finally {
        inFlight.delete(slotId);
      }
    })();
    inFlight.set(slotId, promise);
    promise.then((n) => {
      if (cancelled) return;
      if (n != null) setLeagueNumber(n);
    });
    return () => { cancelled = true; };
  }, [slotId]);

  return leagueNumber;
}
