'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/appApiClient';

export type WheelSpinOutcome = {
  spinId: string;
  result: string;
  prize: {
    type: 'draft_pass' | 'discount' | 'merch' | 'nothing' | 'custom';
    value?: number | string;
  };
  angle: number;
  // Present when the spin was assigned by an active wheel-proof period.
  // The browser verifies `path` against the on-chain `root` for instant
  // "Verified ✓" status.
  proof?: {
    periodNumber: number;
    spinIndex: number;
    leaf: `0x${string}`;
    path: Array<`0x${string}`>;
    root: `0x${string}`;
  } | null;
};

export interface WheelHistoryEntry {
  id: string;
  spinId: string;
  date: string;
  result: string;
}

export function useWheelHistory(userId: string | undefined | null) {
  return useQuery<WheelHistoryEntry[]>({
    queryKey: ['wheel', 'history', userId || ''],
    enabled: !!userId,
    queryFn: async () => {
      const raw = await fetchJson<Array<{ id?: string; spinId?: string; date?: string; result?: string }>>(
        `/api/wheel/history?userId=${encodeURIComponent(userId!)}`,
      );
      if (!Array.isArray(raw)) return [];
      return raw
        .map((h) => ({
          id: h.spinId || h.id || '',
          spinId: h.spinId || h.id || '',
          date: h.date || '',
          result: h.result || '',
        }))
        .filter((h) => h.spinId && h.result);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useSpin(userId: string | undefined | null) {
  const privy = usePrivy();
  const qc = useQueryClient();

  return useMutation<WheelSpinOutcome, Error, void>({
    mutationFn: async () => {
      if (!userId) throw new Error('Not logged in');
      const token = await privy.getAccessToken();
      if (!token) throw new Error('Missing Privy access token');

      const forceResult =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('forceWheel')
          : null;

      return fetchJson<WheelSpinOutcome>('/api/wheel/spin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, ...(forceResult ? { forceResult } : {}) }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wheel', 'history', userId || ''] });
    },
  });
}
