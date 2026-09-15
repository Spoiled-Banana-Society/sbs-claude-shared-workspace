'use client';

import { useMemo } from 'react';
import { useSWRLike } from '@/hooks/useSWRLike';
import { fetchJson } from '@/lib/appApiClient';
import type { TokenStats } from '@/app/api/teams/token-stats/route';

/** Live in-season numbers for specific team tokens (bought teams on My Teams). One fetch per distinct id set; no polling. */
export function useTokenStats(tokenIds: string[]): Map<string, TokenStats> {
  const key = useMemo(() => Array.from(new Set(tokenIds.filter((t) => /^\d+$/.test(t)))).sort((a, b) => Number(a) - Number(b)).join(','), [tokenIds]);
  const query = useSWRLike<{ stats: Record<string, TokenStats> }>(
    key ? `token-stats:${key}` : null,
    ({ signal }) => fetchJson<{ stats: Record<string, TokenStats> }>('/api/teams/token-stats', { signal, query: { tokenIds: key } }),
    { enabled: !!key, fallbackData: { stats: {} }, revalidateOnFocus: true },
  );
  return useMemo(() => new Map(Object.entries(query.data?.stats ?? {})), [query.data]);
}
