'use client';

import type { LeaderboardEntry } from '@/types';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';

export function useLeaderboard() {
  return useSWRLike<LeaderboardEntry[]>(
    'leaderboard',
    ({ signal }) => fetchJson<LeaderboardEntry[]>('/api/leaderboard', { signal }),
    { fallbackData: [], persist: true },
  );
}
