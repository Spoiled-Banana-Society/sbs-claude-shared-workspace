'use client';

import type { Contest, LeaderboardEntry } from '@/types';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';

export function useContests() {
  return useSWRLike<Contest[]>(
    'contests',
    ({ signal }) => fetchJson<Contest[]>('/api/contests', { signal }),
    // Poll so the live total-entries count ticks up as leagues fill, and refresh
    // on tab focus. The server coalesces the underlying read (5s), so cheap.
    { fallbackData: [], refreshInterval: 10_000, revalidateOnFocus: true },
  );
}

export function useContest(contestId?: string | null) {
  return useSWRLike<Contest | null>(
    contestId ? `contest:${contestId}` : null,
    ({ signal }) => fetchJson<Contest>(`/api/contests/${contestId}`, { signal }),
    { enabled: !!contestId, fallbackData: null },
  );
}

export function useContestStandings(contestId?: string | null) {
  return useSWRLike<LeaderboardEntry[]>(
    contestId ? `contestStandings:${contestId}` : null,
    ({ signal }) => fetchJson<LeaderboardEntry[]>(`/api/contests/${contestId}/standings`, { signal }),
    { enabled: !!contestId, fallbackData: [] },
  );
}
