'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppApiError, fetchJson } from '@/lib/appApiClient';
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
  /** Which stack this spin came out of. Absent on legacy responses → treat as
   *  'promo' (the pre-SPIN_ON_PURCHASE behaviour). */
  spinSource?: 'promo' | 'purchase';
  /** Drafts actually CREDITED. Differs from `prize.value` by one on a purchase
   *  spin, where the first draft on the wedge is the seat already bought.
   *  Result copy must read this, never the wedge value. */
  bonusDrafts?: number;
  // Present when the spin was assigned by an active wheel-proof period. The spin
  // response NO LONGER carries the full Merkle proof — building it loads every
  // leaf in the period (~3s at 100k spins) and was blocking the wheel from
  // landing. The client fetches the proof lazily AFTER the wheel stops, via
  // GET /api/wheel/proof/{spinId}, using these identifiers to know it's
  // verifiable. (`proof` kept optional for backward-compat with old responses.)
  periodNumber?: number | null;
  spinIndex?: number | null;
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
  /** Prize the spin paid out — drives the lifetime "won" totals in My Winnings. */
  prize?: { type?: string; value?: number | string } | null;
  /** Which stack paid it. Absent on legacy rows → treat as promo. */
  spinSource?: 'promo' | 'purchase';
  /** Drafts actually credited — wedge minus one on Bonus Spins. */
  bonusDrafts?: number;
}

export function useWheelHistory(userId: string | undefined | null) {
  return useQuery<WheelHistoryEntry[]>({
    queryKey: ['wheel', 'history', userId || ''],
    enabled: !!userId,
    queryFn: async () => {
      const raw = await fetchJson<Array<{ id?: string; spinId?: string; date?: string; result?: string; prize?: { type?: string; value?: number | string } | null; spinSource?: 'promo' | 'purchase'; bonusDrafts?: number }>>(
        `/api/wheel/history?userId=${encodeURIComponent(userId!)}`,
      );
      if (!Array.isArray(raw)) return [];
      return raw
        .map((h) => ({
          id: h.spinId || h.id || '',
          spinId: h.spinId || h.id || '',
          date: h.date || '',
          result: h.result || '',
          prize: h.prize ?? null,
          spinSource: h.spinSource,
          bonusDrafts: h.bonusDrafts,
        }))
        .filter((h) => h.spinId && h.result);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// How long one spin request may take before we give up on it and retry. The
// server answers in well under a second normally; a lost response (mobile
// network blip, request that never arrived) is what this catches. Kept short
// enough that free-spin + retry still feels like one spin.
const SPIN_REQUEST_TIMEOUT_MS = 10_000;
const SPIN_RETRY_DELAY_MS = 1_000;

function newClientSpinId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Older mobile Safari: RFC-4122 v4 from getRandomValues (matches the
  // server's strict UUID check).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** True only when the server did NOT answer (timeout / network drop / empty
 *  body). An HTTP error (4xx/5xx) is a real answer and is never retried. */
function isTransportFailure(err: unknown): boolean {
  if (err instanceof AppApiError) return false;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true; // our timeout
  return err instanceof TypeError; // "Failed to fetch" / "Load failed"
}

export function useSpin(userId: string | undefined | null) {
  const privy = usePrivy();
  // NOTE: queryClient is intentionally NOT used here — spin-history
  // invalidation lives on the wheel page's handleSpinComplete callback
  // (after the wheel lands) instead of in onSuccess (which fires
  // immediately on server response, ~5s before the animation finishes).
  // Moving the invalidation prevents the spin from appearing in the
  // history sidebar before the wheel even lands on the prize.

  return useMutation<WheelSpinOutcome, Error, void>({
    mutationFn: async () => {
      if (!userId) throw new Error('Not logged in');

      const forceResult =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('forceWheel')
          : null;

      // One id per SPIN (not per request). The server treats it as an
      // idempotency key: if the first request actually settled but its
      // response never reached us, the retry gets the SAME outcome back
      // (replayed) — never a second spin, never a different wedge.
      const clientSpinId = newClientSpinId();

      const attempt = async (): Promise<WheelSpinOutcome> => {
        const token = await privy.getAccessToken();
        if (!token) {
          throw new Error('Your session expired — please log out and log back in to continue.');
        }
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), SPIN_REQUEST_TIMEOUT_MS);
        try {
          const outcome = await fetchJson<WheelSpinOutcome | null>('/api/wheel/spin', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId, clientSpinId, ...(forceResult ? { forceResult } : {}) }),
            signal: ac.signal,
          });
          // A 200 whose body died mid-flight parses to null — that is a lost
          // response too, and the retry will replay it.
          if (!outcome || typeof outcome.spinId !== 'string') {
            throw new TypeError('Empty spin response');
          }
          return outcome;
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        return await attempt();
      } catch (err) {
        if (!isTransportFailure(err)) throw err;
        reportClientError({
          source: LOG_SOURCES.wheel.SPIN_RETRIED,
          message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          route: 'banana-wheel',
          context: { userId, clientSpinId },
        });
        await new Promise((r) => setTimeout(r, SPIN_RETRY_DELAY_MS));
        return attempt();
      }
    },
    // NOTE: Spin-history invalidation deliberately NOT in onSuccess.
    // It used to live here, but it fires the moment the server returns
    // — which is BEFORE the wheel finishes its 5s landing animation.
    // The spin history would refresh with the new win in the right
    // column while the wheel was still spinning, spoiling the reveal.
    // The wheel page now invalidates this query from handleSpinComplete
    // (after the wheel lands) instead. See banana-wheel/page.tsx.
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
