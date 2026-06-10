'use client';

import { useMemo, useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import type { EligibilityStatus, PrizeHistoryItem, PrizeWithdrawal } from '@/types';
import { AppApiError, fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useStreamRefetch } from '@/hooks/useStreamRefetch';

interface WithdrawResponse {
  status: PrizeWithdrawal['status'];
  withdrawal: PrizeWithdrawal;
}

interface WithdrawAllResponse {
  withdrawal: PrizeWithdrawal & { prizeIds?: string[] };
  totalAmount: number;
  prizeCount: number;
}

export function usePrizes(opts?: { userId?: string }) {
  const { user } = useAuth();
  const privy = usePrivy();
  const ownerId = opts?.userId ?? user?.walletAddress ?? user?.id;
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const query = useSWRLike<PrizeHistoryItem[]>(
    ownerId ? `prizes:history:${ownerId}` : null,
    // The history endpoint is auth-required (money data) — attach the
    // Privy JWT. Safe re: render-loop rule: useSWRLike stores the
    // fetcher in a ref, so the privy-derived callback never enters a
    // dep array.
    async ({ signal }) => {
      const token = await privy.getAccessToken();
      return fetchJson<PrizeHistoryItem[]>('/api/prizes/history', {
        signal,
        query: { userId: ownerId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
    { enabled: !!ownerId, fallbackData: [] },
  );
  const refresh = query.mutate;

  // Instant: a prize grant fires a server noti ping — refresh winnings within
  // ~300ms instead of only on page load / manual refresh.
  useStreamRefetch(ownerId, () => { void refresh(); });

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

  // Sum of pending wins — the user-facing balance number rendered at
  // the top of /prizes. Excludes wins still in 'processing' (mid-flight
  // withdrawal) so the balance reflects what's still claimable.
  const availableBalance = useMemo(() => {
    return prizes
      .filter((item) => item.type === 'win' && item.status === 'pending')
      .reduce((sum, item) => sum + item.amount, 0);
  }, [prizes]);

  // Sum of wins currently mid-withdrawal — admin queue / Gnosis batch.
  const inFlightBalance = useMemo(() => {
    return prizes
      .filter((item) => item.type === 'win' && item.status === 'processing')
      .reduce((sum, item) => sum + item.amount, 0);
  }, [prizes]);

  // Withdraw pending prizes as a single unified request. Backend
  // creates one withdrawalRequests doc with prizeIds covering every
  // settled prize; admin marks it paid once → all prizes flip atomically.
  //
  // Optional `amount` caps the withdrawal (greedy oldest-first
  // allocation up to that cap). Omit for "withdraw everything".
  const withdrawAll = useCallback(async (
    method: PrizeWithdrawal['method'] = 'usdc',
    amount?: number,
  ): Promise<WithdrawAllResponse> => {
    if (!ownerId) throw new Error('Missing user id');
    setWithdrawError(null);
    try {
      const token = await privy.getAccessToken();
      const response = await fetchJson<WithdrawAllResponse>('/api/prizes/withdraw-all', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({
          userId: ownerId,
          method,
          ...(typeof amount === 'number' ? { amount } : {}),
        }),
      });
      await refresh();
      return response;
    } catch (err) {
      if (err instanceof AppApiError && err.status === 403 && err.body) {
        const body = err.body as Record<string, unknown>;
        if (body.requiresVerification) {
          throw { requiresVerification: body.requiresVerification };
        }
      }
      let message = 'Withdrawal failed. Please try again.';
      if (err instanceof AppApiError) message = err.message || message;
      else if (err instanceof Error && err.message) message = err.message;
      setWithdrawError(message);
      throw new Error(message);
    }
  }, [ownerId, privy, refresh]);

  return {
    prizes,
    totalWinnings,
    pendingWithdrawals,
    availableBalance,
    inFlightBalance,
    isLoading: query.isLoading,
    isValidating: query.isValidating,
    error: query.error,
    withdrawError,
    withdraw,
    withdrawAll,
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
