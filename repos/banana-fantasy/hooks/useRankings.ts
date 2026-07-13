'use client';

import type { TeamPosition } from '@/types';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';

export function useRankings() {
  const swr = useSWRLike<TeamPosition[]>(
    'rankings',
    ({ signal }) => fetchJson<TeamPosition[]>('/api/rankings', { signal }),
    { fallbackData: [], persist: true },
  );

  return {
    data: swr.data,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
