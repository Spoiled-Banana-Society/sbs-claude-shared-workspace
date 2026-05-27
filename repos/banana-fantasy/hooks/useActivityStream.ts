'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import type { ActivityEventType, WalletType, PaymentMethod, DevicePlatform } from '@/lib/activityEvents';

export interface LiveActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string;
  walletAddress: string;
  username: string | null;
  walletType: WalletType;
  paymentMethod: PaymentMethod;
  quantity: number;
  tokenIds: string[];
  txHash: string | null;
  metadata: Record<string, unknown>;
  devicePlatform: DevicePlatform;
  userAgent: string | null;
  createdAt: number | null;
  createdAtIso: string;
}

export interface UseActivityStreamResult {
  events: LiveActivityEvent[];
  isConnected: boolean;
  error: string | null;
}

/**
 * Subscribe to a Server-Sent Events activity stream. Accepts any URL that
 * returns `snapshot` events with `{ events: LiveActivityEvent[] }` payloads
 * — works for both the admin-wide `/api/admin/activity/stream` and the
 * per-user `/api/user/activity/stream?userId=…` endpoints.
 *
 * Handles:
 * - Auto-reconnect (built into EventSource).
 * - Graceful teardown on unmount / URL change.
 * - Returns `isConnected` so the UI can show a live indicator.
 */
export function useActivityStream(url: string | null): UseActivityStreamResult {
  const { getAccessToken, authenticated } = usePrivy();
  const [events, setEvents] = useState<LiveActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authedUrl, setAuthedUrl] = useState<string | null>(null);

  // Ref getAccessToken so the resolve-token effect doesn't re-run on every
  // Privy re-render. See [[render-loop-self-ddos]].
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);

  // Native EventSource can't send custom headers — so for the admin
  // stream (which requires a Bearer JWT), we resolve the Privy access
  // token first and append it as ?token=… The server (lib/auth.ts)
  // accepts that query-param fallback only when no Authorization
  // header is present, which is exactly the EventSource case.
  // For per-user activity streams (/api/user/activity/stream?userId=…)
  // the route accepts an unauthenticated stream tied to the wallet
  // parameter, so we pass the URL through as-is.
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setAuthedUrl(null);
      return;
    }
    const needsToken = url.startsWith('/api/admin/');
    if (!needsToken) {
      setAuthedUrl(url);
      return;
    }
    if (!authenticated) {
      setAuthedUrl(null);
      return;
    }
    (async () => {
      try {
        const token = await getAccessTokenRef.current();
        if (cancelled) return;
        if (!token) {
          setAuthedUrl(null);
          return;
        }
        const sep = url.includes('?') ? '&' : '?';
        setAuthedUrl(`${url}${sep}token=${encodeURIComponent(token)}`);
      } catch {
        if (!cancelled) setAuthedUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, authenticated]);

  useEffect(() => {
    if (!authedUrl) {
      setEvents([]);
      setIsConnected(false);
      return;
    }

    let cancelled = false;
    const es = new EventSource(authedUrl);

    const handleSnapshot = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { events?: LiveActivityEvent[] };
        if (!cancelled && Array.isArray(payload.events)) {
          setEvents(payload.events);
          setIsConnected(true);
          setError(null);
        }
      } catch {
        /* malformed SSE data — ignore */
      }
    };

    es.addEventListener('snapshot', handleSnapshot);
    es.addEventListener('update', handleSnapshot);

    es.onopen = () => {
      if (!cancelled) {
        setIsConnected(true);
        setError(null);
      }
    };

    es.onerror = () => {
      if (!cancelled) {
        setIsConnected(false);
        setError('connection_error');
      }
    };

    return () => {
      cancelled = true;
      es.close();
      setIsConnected(false);
    };
  }, [authedUrl]);

  return { events, isConnected, error };
}
