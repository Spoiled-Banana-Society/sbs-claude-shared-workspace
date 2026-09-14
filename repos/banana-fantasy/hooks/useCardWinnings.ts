'use client';

import { useCallback, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';
import { fetchJson } from '@/lib/appApiClient';
import type { CardWinnings } from '@/lib/cardWinnings';

interface CardsResponse { cards: CardWinnings[]; total: number }
export interface TransferResult { transferred: Array<{ tokenId: string; amount: number; leagueName: string }>; total: number; skipped: Array<{ tokenId: string; reason: string }> }

/** Weekly prize money sitting on the cards this wallet owns, plus the card → site-balance transfer. No polling. */
export function useCardWinnings(opts?: { userId?: string }) {
  const { user } = useAuth();
  const privy = usePrivy();
  const ownerId = (opts?.userId ?? user?.walletAddress ?? '').toLowerCase();

  const query = useSWRLike<CardsResponse>(
    ownerId ? `cardwinnings:${ownerId}` : null,
    async ({ signal }) => {
      const token = await privy.getAccessToken();
      return fetchJson<CardsResponse>('/api/prizes/cards', { signal, query: { userId: ownerId }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    },
    { enabled: !!ownerId, fallbackData: { cards: [], total: 0 }, revalidateOnFocus: true },
  );

  const byToken = useMemo(() => new Map((query.data?.cards ?? []).map((c) => [c.tokenId, c])), [query.data]);

  const transfer = useCallback(async (tokenIds?: string[]): Promise<TransferResult> => {
    const token = await privy.getAccessToken();
    const res = await fetchJson<TransferResult>('/api/prizes/transfer', {
      method: 'POST',
      body: JSON.stringify({ userId: ownerId, tokenIds }),
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    await query.mutate();
    return res;
  }, [ownerId, privy, query]);

  return { cards: query.data?.cards ?? [], total: query.data?.total ?? 0, byToken, isLoading: query.isLoading, refresh: query.mutate, transfer };
}
