'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Promo } from '@/types';
import { AppApiError, fetchJson } from '@/lib/appApiClient';
import { pushNotification } from '@/components/NotificationCenter';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';
import { useClaimCelebration } from '@/contexts/ClaimCelebrationContext';
import { subscribeUserEvents } from '@/lib/api/firebase';

type ClaimPromoResponse = {
  promo: Promo;
  spinsAdded: number;
  user: unknown;
};

type ClaimPromoResult = ClaimPromoResponse | Error | null;

export function usePromos(opts?: { userId?: string }) {
  const { user, updateUser } = useAuth();
  const { celebrate } = useClaimCelebration();
  const userId = opts?.userId ?? user?.id;

  const swr = useSWRLike<Promo[]>(
    userId ? `promos:${userId}` : 'promos:anon',
    ({ signal }) => fetchJson<Promo[]>('/api/promos', { signal, query: userId ? { userId } : {} }),
    { fallbackData: [] },
  );

  // optimistic local update after claims
  const [localPromos, setLocalPromos] = useState<Promo[] | null>(null);
  const mutateRef = useRef(swr.mutate);

  useEffect(() => {
    mutateRef.current = swr.mutate;
  }, [swr.mutate]);

  useEffect(() => {
    // keep local promos in sync with SWR source when it changes
    setLocalPromos(swr.data);
    // DIAGNOSTIC: when fresh promo data lands, log the mint progress so we can
    // see end-to-end latency (ping.recv → data rendered) vs delivery latency.
    const mint = swr.data?.find((p) => p.type === 'mint');
    if (mint) {
      import('@/lib/clientLog').then(({ clientLog }) => clientLog('sync#', 'promos.data', {
        mintProgress: mint.progressCurrent ?? null,
        totalMinted: mint.modalContent?.totalMinted ?? null,
      })).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swr.data]);

  const promos = useMemo(() => localPromos ?? swr.data, [localPromos, swr.data]);

  const claimPromo = useCallback(
    async (promoId: string): Promise<ClaimPromoResult> => {
      if (!userId) return null;

      try {
        const res = await fetchJson<ClaimPromoResponse>('/api/promos/claim', {
          method: 'POST',
          body: JSON.stringify({ userId, promoId }),
        });

        // Update only Firestore-managed balance fields from the response.
        // Do NOT spread the full user — it lacks draftPasses (from Go backend)
        // and would overwrite the correct value with 0.
        if (res.user && typeof res.user === 'object') {
          const u = res.user as Record<string, unknown>;
          const balanceUpdate: Record<string, unknown> = {};
          if (typeof u.wheelSpins === 'number') balanceUpdate.wheelSpins = u.wheelSpins;
          if (typeof u.freeDrafts === 'number') balanceUpdate.freeDrafts = u.freeDrafts;
          if (typeof u.jackpotEntries === 'number') balanceUpdate.jackpotEntries = u.jackpotEntries;
          if (typeof u.hofEntries === 'number') balanceUpdate.hofEntries = u.hofEntries;
          if (Object.keys(balanceUpdate).length > 0) updateUser(balanceUpdate);
        }

        // Patch the promo in the local list
        setLocalPromos((prev) => {
          const base = prev ?? swr.data ?? [];
          const next = base.map((p) => (p.id === promoId ? res.promo : p));
          return next;
        });

        // Revalidate in background (keeps everything consistent)
        void mutateRef.current();

        // The persistent "Promo Claimed!" bell entry is now created
        // SERVER-SIDE in claimPromo (real-time content-carrying ping → instant
        // on every device). Here we only fire the local celebration modal,
        // which should stay instant on the acting device.
        if (res.spinsAdded > 0) {
          celebrate({ count: res.spinsAdded, promoType: res.promo?.type });
        }

        return res;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to claim promo.');
        pushNotification({
          type: 'promo',
          title: 'Claim failed',
          message: error.message,
        });
        return error;
      }
    },
    [userId, swr.data, updateUser, celebrate],
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
          void mutateRef.current();
        }

        return res;
      } catch (err) {
        const msg = err instanceof AppApiError ? err.message : 'Verification failed. Please try again.';
        return { verified: false, message: msg };
      }
    },
    [userId, user?.xHandle, swr.data],
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
        void mutateRef.current();
        return res;
      } catch {
        return null;
      }
    },
    [userId, user?.username],
  );

  const refreshPromos = useCallback(() => mutateRef.current(), []);

  // Keep all promo boxes (progress, claimable, etc.) live across devices:
  //  - real-time refetch on any user-event stream ping (purchases fire one),
  //    coalesced to one refetch per ~300ms burst (render-loop safe — deps are
  //    scalar, mutate is in a ref),
  //  - instant refetch on focus/visibility (covers "buy on desktop, look at phone"),
  //  - 60s poll as a backstop.
  useEffect(() => {
    const refetch = () => { void mutateRef.current(); };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const coalesced = () => { if (timer) return; timer = setTimeout(() => { timer = null; refetch(); }, 300); };
    const onVisible = () => { if (document.visibilityState !== 'hidden') coalesced(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Mobile PWAs suspend the realtime websocket → poll tightly there so promo
    // boxes stay near-real-time; desktop relies on the websocket + slow poll.
    const isMobile = typeof navigator !== 'undefined' && /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    const interval = setInterval(refetch, isMobile ? 6_000 : 60_000);
    const unsub = userId ? subscribeUserEvents(userId, (event) => {
      // DIAGNOSTIC: measure server-fire → client-receive latency per device.
      import('@/lib/clientLog').then(({ clientLog }) => clientLog('sync#', 'promos.ping.recv', {
        type: event.type, src: event.source ?? null,
        ageMs: event.timestamp ? Date.now() - event.timestamp : null,
      })).catch(() => {});
      coalesced();
    }) : () => {};
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      try { unsub(); } catch { /* ignore */ }
    };
  }, [userId]);

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
