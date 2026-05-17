'use client';

import { useEffect, useState } from 'react';

const SLOT_ID_RE = /^\d{4}-(fast|slow)-draft-\d+$/;

// Module-level cache so multiple badges for the same slot share the
// resolved value across the page lifetime. Slot → league mapping is
// immutable once a draft is assigned, so cache forever.
const cache = new Map<string, number>();
const inFlight = new Map<string, Promise<number | null>>();

/**
 * Resolves a draft slot id (e.g. `2024-fast-draft-802`) to its global
 * league number (e.g. 803) via /api/drafts/{slotId}/league-number.
 *
 * Needed because the slot-id counter (per-speed-per-year) drifts from
 * the global FilledLeaguesCount over time, so the slot number embedded
 * in a draft.id can't be trusted as the league number. The doc's
 * DisplayName field is the source of truth.
 *
 * Returns null for queue drafts or until the resolution completes.
 *
 * Designed for use directly in render — the badge can fall back to the
 * slot id while resolution is in flight (the /proof/{slotId} page will
 * itself resolve + redirect). Once resolved, the badge updates to use
 * the correct global number directly.
 */
export function useLeagueNumberForSlot(slotId: string | undefined): number | null {
  const initial = slotId ? cache.get(slotId) ?? null : null;
  const [leagueNumber, setLeagueNumber] = useState<number | null>(initial);

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
        const res = await fetch(`/api/drafts/${slotId}/league-number`);
        if (!res.ok) return null;
        const body = (await res.json()) as { leagueNumber?: number };
        if (typeof body.leagueNumber === 'number') {
          cache.set(slotId, body.leagueNumber);
          return body.leagueNumber;
        }
        return null;
      } catch {
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
