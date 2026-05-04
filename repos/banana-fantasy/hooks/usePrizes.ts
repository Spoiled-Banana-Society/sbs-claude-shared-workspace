'use client';

import { useMemo, useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import type { EligibilityStatus, PrizeHistoryItem, PrizeWithdrawal } from '@/types';
import { AppApiError, fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';

interface WithdrawResponse {
  status: PrizeWithdrawal['status'];
  withdrawal: PrizeWithdrawal;
}

export function usePrizes(opts?: { userId?: string }) {
  const { user } = useAuth();
  const privy = usePrivy();
  const ownerId = opts?.userId ?? user?.walletAddress ?? user?.id;
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const query = useSWRLike<PrizeHistoryItem[]>(
    ownerId ? `prizes:history:${ownerId}` : null,
    ({ signal }) => fetchJson<PrizeHistoryItem[]>('/api/prizes/history', { signal, query: { userId: ownerId } }),
    { enabled: !!ownerId, fallbackData: [] },
  );
  const refresh = query.mutate;

  const prizes = query.data ?? [];

  const totalWinnings = useMemo(() => {
    return prizes
      .filter((item) => item.type === 'win' && item.status === 'paid')
      .reduce((sum, item) => sum + item.amount, 0);
  }, [prizes]);

  const pendingWithdrawals = useMemo(() => {
    return prizes
      .filter((item) => item.type === 'withdrawal' && (item.status === 'pending' || item.status === 'processing'))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [prizes]);

  const withdraw = useCallback(
    async (draftId: string, amount: number, method: PrizeWithdrawal['method']): Promise<PrizeWithdrawal> => {
      if (!ownerId) throw new Error('Missing user id');
      setWithdrawError(null);
      try {
        const token = await privy.getAccessToken();
        const response = await fetchJson<WithdrawResponse>('/api/prizes/withdraw', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: JSON.stringify({ userId: ownerId, draftId, amount, method }),
        });
        await refresh();
        return response.withdrawal;
      } catch (err) {
        // Check if API returned a verification requirement (403 with requiresVerification)
        if (err instanceof AppApiError && err.status === 403 && err.body) {
          const body = err.body as Record<string, unknown>;
          if (body.requiresVerification) {
            throw { requiresVerification: body.requiresVerification };
          }
        }

        let message = 'Withdrawal failed. Please try again.';
        if (err instanceof AppApiError) {
          message = err.message || message;
          if (err.status === 400) {
            message = err.message || 'Please check your withdrawal details and try again.';
          } else if (err.status === 429) {
            message = 'Withdrawal is already processing. Please check back shortly.';
          } else if (err.status && err.status >= 500) {
            message = 'Withdrawal service is unavailable. Please try again later.';
          }
        } else if (err instanceof Error && err.message) {
          message = err.message;
        }
        setWithdrawError(message);
        throw new Error(message);
      }
    },
    [ownerId, privy, refresh],
  );

  return {
    prizes,
    totalWinnings,
    pendingWithdrawals,
    isLoading: query.isLoading,
    error: query.error,
    withdrawError,
    withdraw,
    refresh,
  };
}

export function useEligibility(opts?: { userId?: string }) {
  const { user } = useAuth();
  const userId = opts?.userId ?? user?.walletAddress ?? user?.id;

  return useSWRLike<EligibilityStatus>(
    userId ? `eligibility:${userId}` : null,
    ({ signal }) => fetchJson<EligibilityStatus>('/api/eligibility', { signal, query: { userId } }),
    { enabled: !!userId, fallbackData: { isVerified: false, season: 0, w9Completed: false, tier1Verified: false, tier2Verified: false, cumulativeWithdrawals: 0 } },
  );
}
