'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Purchase, PurchaseCreateResponse, PurchasePaymentMethod } from '@/types';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';

type VerifyPurchaseResponse = {
  purchase: Purchase;
  user: unknown;
  spinsAdded: number;
  draftPassesAdded: number;
  freeDraftsAdded: number;
};

export function usePurchases(opts?: { userId?: string }) {
  const { user, updateUser, refreshBalance } = useAuth();
  const userId = opts?.userId ?? user?.id;

  const swr = useSWRLike<Purchase[]>(
    userId ? `purchaseHistory:${userId}` : null,
    ({ signal }) => fetchJson<Purchase[]>('/api/purchases/history', { signal, query: { userId } }),
    { enabled: !!userId, fallbackData: [] },
  );

  const [localHistory, setLocalHistory] = useState<Purchase[] | null>(null);

  useEffect(() => {
    setLocalHistory(swr.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swr.data]);

  const history = useMemo(() => localHistory ?? swr.data, [localHistory, swr.data]);

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);

  const createPurchase = useCallback(
    async (quantity: number, paymentMethod: PurchasePaymentMethod): Promise<PurchaseCreateResponse | null> => {
      if (!userId) return null;
      setIsCreating(true);
      setCreateError(null);
      try {
        const res = await fetchJson<PurchaseCreateResponse>('/api/purchases/create', {
          method: 'POST',
          body: JSON.stringify({ userId, quantity, paymentMethod }),
        });

        setLocalHistory((prev) => {
          const base = prev ?? history ?? [];
          return [res.purchase, ...base];
        });

        void swr.mutate();
        return res;
      } catch (err) {
        setCreateError(err);
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [history, swr, userId],
  );

  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<unknown>(null);

  const verifyPurchase = useCallback(
    async (purchaseId: string, txHash: string): Promise<VerifyPurchaseResponse | null> => {
      setIsVerifying(true);
      setVerifyError(null);
      try {
        const res = await fetchJson<VerifyPurchaseResponse>('/api/purchases/verify', {
          method: 'POST',
          body: JSON.stringify({ purchaseId, txHash }),
        });

        if (res.user) updateUser(res.user);
        void refreshBalance();

        setLocalHistory((prev) => {
          const base = prev ?? history ?? [];
          return base.map((p) => (p.id === purchaseId ? res.purchase : p));
        });

        void swr.mutate();
        return res;
      } catch (err) {
        setVerifyError(err);

        // Local fallback: still grant passes for demo.
        if (user) {
          updateUser({
            draftPasses: (user.draftPasses || 0) + 0,
          });
        }

        return null;
      } finally {
        setIsVerifying(false);
      }
    },
    [history, swr, updateUser, user],
  );

  return {
    ...swr,
    history,
    createPurchase,
    verifyPurchase,
    isCreating,
    createError,
    isVerifying,
    verifyError,
    userId,
  };
}
