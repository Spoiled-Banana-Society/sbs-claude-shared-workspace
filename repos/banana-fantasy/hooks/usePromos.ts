'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Promo } from '@/types';
import { AppApiError, fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';

type ClaimPromoResponse = {
  promo: Promo;
  spinsAdded: number;
  user: unknown;
};

export function usePromos(opts?: { userId?: string }) {
  const { user, updateUser } = useAuth();
  const userId = opts?.userId ?? user?.id;

  const swr = useSWRLike<Promo[]>(
    userId ? `promos:${userId}` : 'promos:anon',
    ({ signal }) => fetchJson<Promo[]>('/api/promos', { signal, query: userId ? { userId } : {} }),
    { fallbackData: [] },
  );

  // optimistic local update after claims
  const [localPromos, setLocalPromos] = useState<Promo[] | null>(null);

  useEffect(() => {
    // keep local promos in sync with SWR source when it changes
    setLocalPromos(swr.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swr.data]);

  const promos = useMemo(() => localPromos ?? swr.data, [localPromos, swr.data]);

  const claimPromo = useCallback(
    async (promoId: string): Promise<ClaimPromoResponse | null> => {
      if (!userId) return null;

      try {
        const res = await fetchJson<ClaimPromoResponse>('/api/promos/claim', {
          method: 'POST',
          body: JSON.stringify({ userId, promoId }),
        });

        // Update auth user (wheel spins, etc)
        if (res.user) {
          updateUser(res.user);
        }

        // Patch the promo in the local list
        setLocalPromos((prev) => {
          const base = prev ?? swr.data ?? [];
          const next = base.map((p) => (p.id === promoId ? res.promo : p));
          return next;
        });

        // Revalidate in background (keeps everything consistent)
        void swr.mutate();

        return res;
      } catch {
        // Fallback: mark promo as claimed locally so UI never looks broken.
        setLocalPromos((prev) => {
          const base = prev ?? swr.data ?? [];
          return base.map((p) =>
            p.id === promoId
              ? { ...p, claimable: false, claimCount: 0 }
              : p,
          );
        });

        return null;
      }
    },
    [userId, swr, updateUser],
  );

  const verifyTweetEngagement = useCallback(
    async (promoId: string): Promise<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null> => {
      if (!userId || !user?.xHandle) return { verified: false, message: 'Connect your X account first.' };

      try {
        const res = await fetchJson<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string }>(
          '/api/promos/verify-tweet',
          {
            method: 'POST',
            body: JSON.stringify({ userId, xHandle: user.xHandle }),
          },
        );

        if (res.verified) {
          setLocalPromos((prev) => {
            const base = prev ?? swr.data ?? [];
            return base.map((p) =>
              p.id === promoId ? { ...p, claimable: true, claimCount: 1 } : p,
            );
          });
          void swr.mutate();
        }

        return res;
      } catch (err) {
        const msg = err instanceof AppApiError ? err.message : 'Verification failed. Please try again.';
        return { verified: false, message: msg };
      }
    },
    [userId, user?.xHandle, swr],
  );

  const generateReferralCode = useCallback(
    async (): Promise<{ code: string; link: string } | null> => {
      if (!userId) return null;
      try {
        const res = await fetchJson<{ code: string; link: string }>(
          '/api/promos/referral/generate',
          {
            method: 'POST',
            body: JSON.stringify({ userId, username: user?.username }),
          },
        );
        // Refresh promos so the referral link appears
        void swr.mutate();
        return res;
      } catch {
        return null;
      }
    },
    [userId, user?.username, swr],
  );

  const refreshPromos = useCallback(() => swr.mutate(), [swr]);

  return {
    ...swr,
    promos,
    claimPromo,
    verifyTweetEngagement,
    generateReferralCode,
    refreshPromos,
    userId,
  };
}
