'use client';

import { useEffect, useState } from 'react';
import { Rankings } from '@/utils/api';

export interface PlayerOverride {
  rank?: number;
  adp?: number;
  byeWeek?: number;
}

/**
 * Fetches the user's saved player rankings from the Go API and returns
 * a Map<playerId, { rank, adp, byeWeek }>.
 *
 * Used in the draft room as a fallback: the per-draft endpoint
 * /draft/{id}/playerState/{wallet} doesn't exist until a draft starts
 * (Firestore doc is created on draft kickoff), so at 1/10 the player list
 * has no live data and falls back to hardcoded defaults — which include
 * stale ADP values (e.g. TB-WR1 shown as ADP 57 instead of 20). The
 * /owner/{wallet}/rankings/get response includes real stats.adp and
 * stats.byeWeek, so we can patch over the hardcoded defaults.
 */
export function useUserRankings(walletAddress: string | undefined | null) {
  const [rankMap, setRankMap] = useState<Map<string, number>>(new Map());
  const [overrideMap, setOverrideMap] = useState<Map<string, PlayerOverride>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setRankMap(new Map());
      setOverrideMap(new Map());
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await Rankings.getRankings(walletAddress);
        if (cancelled) return;
        const nextRank = new Map<string, number>();
        const nextOverride = new Map<string, PlayerOverride>();
        if (Array.isArray(res)) {
          for (const r of res) {
            if (!r?.playerId) continue;
            const entry: PlayerOverride = {};
            if (typeof r.rank === 'number') {
              nextRank.set(r.playerId, r.rank);
              entry.rank = r.rank;
            }
            const adp = r.stats?.adp;
            if (typeof adp === 'number' && adp > 0) entry.adp = adp;
            const byeRaw = r.stats?.byeWeek;
            const bye = typeof byeRaw === 'number' ? byeRaw : Number(byeRaw);
            if (Number.isFinite(bye) && bye > 0) entry.byeWeek = bye;
            if (entry.rank !== undefined || entry.adp !== undefined || entry.byeWeek !== undefined) {
              nextOverride.set(r.playerId, entry);
            }
          }
        }
        setRankMap(nextRank);
        setOverrideMap(nextOverride);
      } catch {
        if (!cancelled) {
          setRankMap(new Map());
          setOverrideMap(new Map());
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  return { rankMap, overrideMap, loaded };
}
