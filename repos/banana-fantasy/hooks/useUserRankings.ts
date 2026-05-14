'use client';

import { useEffect, useState } from 'react';
import { Rankings } from '@/utils/api';

/**
 * Fetches the user's saved player rankings from the Go API and returns
 * a Map<playerId, rank>.
 *
 * Used in the draft room as a fallback: the per-draft endpoint
 * /draft/{id}/playerState/{wallet} doesn't exist until a draft starts
 * (Firestore doc is created on draft kickoff), so at 1/10 the player list
 * has no live ranks and falls back to hardcoded defaults. With this map,
 * the list can still respect the user's saved rankings while waiting.
 */
export function useUserRankings(walletAddress: string | undefined | null) {
  const [rankMap, setRankMap] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setRankMap(new Map());
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await Rankings.getRankings(walletAddress);
        if (cancelled) return;
        const next = new Map<string, number>();
        if (Array.isArray(res)) {
          for (const r of res) {
            if (r?.playerId && typeof r.rank === 'number') {
              next.set(r.playerId, r.rank);
            }
          }
        }
        setRankMap(next);
      } catch {
        if (!cancelled) setRankMap(new Map());
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  return { rankMap, loaded };
}
