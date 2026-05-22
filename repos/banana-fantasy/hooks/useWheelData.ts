'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/appApiClient';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

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
      if (!token) {
        throw new Error('Your session expired — please log out and log back in to continue.');
      }

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
    onError: (err) => {
      // Spin failures were invisible to admin — React Query swallows the
      // error into mutation state. Report it with Privy state + session
      // age so we can tell a clean 30-day Privy expiry apart from early
      // mobile storage-eviction (a missing login record = storage was
      // cleared), and apart from a genuinely-logged-out user.
      let sessionAgeDays: string | number = 'unknown — login record missing (storage may have been cleared)';
      try {
        const started = localStorage.getItem('banana-session-started');
        if (started) {
          sessionAgeDays = Math.round((Date.now() - Number(started)) / 8_640_000) / 10;
        }
      } catch { /* ignore */ }
      reportClientError({
        source: LOG_SOURCES.wheel.SPIN_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'banana-wheel',
        // actor (the user) is auto-attached by reportClientError.
        context: {
          userId,
          privyReady: privy.ready,
          privyAuthenticated: privy.authenticated,
          hasPrivyUser: !!privy.user,
          sessionAgeDays,
          isMobile:
            typeof navigator !== 'undefined' &&
            /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
        },
        stack: err instanceof Error ? err.stack : undefined,
      });
    },
  });
}
