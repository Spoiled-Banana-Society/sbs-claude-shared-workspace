'use client';

import type { League } from '@/types';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';
import { getOwnerLeaguesFromDraftTokens } from '@/lib/api/owner';

/**
 * Fetch the current user's leagues from the real backend.
 */
export function useLeagues(opts?: { userId?: string; status?: 'active' | 'completed' | 'all' }) {
  const { user } = useAuth();
  const wallet = user?.walletAddress ?? opts?.userId;
  const statusFilter = opts?.status ?? 'all';

  return useSWRLike<League[]>(
    wallet ? `leagues:${wallet}:${statusFilter}` : null,
    async () => {
      const leagues = await getOwnerLeaguesFromDraftTokens(wallet!);
      if (statusFilter === 'all') return leagues;
      return leagues.filter((l) => l.status === statusFilter);
    },
    { enabled: !!wallet, fallbackData: [], persist: true },
  );
}
