'use client';

/**
 * Robust push-subscription management for the notification settings page.
 *
 * Replaces the permission-only logic that mislabeled "Connected": the real
 * connected state is the OneSignal push subscription being **opted in with
 * a subscription id** — not merely the browser permission being granted.
 *
 * connect() does the full chain and reports success/failure:
 *   request browser permission → opt the push subscription in → wait for
 *   the subscription id → tag the device with the wallet (so server-side
 *   targeting by `walletAddress` works) → register with our backend.
 */

import { useCallback, useEffect, useState } from 'react';
import OneSignal from 'react-onesignal';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

export type PushState = 'loading' | 'connected' | 'disconnected';

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True when the OneSignal push subscription is opted in and has an id. */
function readConnected(): boolean {
  try {
    const sub = OneSignal?.User?.PushSubscription;
    return !!sub && sub.optedIn === true && !!sub.id;
  } catch {
    return false;
  }
}

export function usePushSubscription() {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const wallet = user?.walletAddress?.toLowerCase() ?? null;

  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial read + react to OneSignal subscription changes.
  useEffect(() => {
    let mounted = true;
    const sync = () => {
      if (mounted) setState(readConnected() ? 'connected' : 'disconnected');
    };
    // Give the OneSignal SDK a moment to finish initializing.
    const t = setTimeout(sync, 800);
    let listening = false;
    try {
      OneSignal?.User?.PushSubscription?.addEventListener?.('change', sync);
      listening = true;
    } catch {
      /* SDK not ready — the timeout still does an initial read */
    }
    return () => {
      mounted = false;
      clearTimeout(t);
      if (listening) {
        try {
          OneSignal.User.PushSubscription.removeEventListener('change', sync);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const connect = useCallback(async (): Promise<PushActionResult> => {
    setBusy(true);
    setError(null);
    try {
      // 1. Browser permission.
      await OneSignal.Notifications.requestPermission();
      if (OneSignal.Notifications.permission !== true) {
        const msg =
          'Notifications are blocked in your browser. Allow them for this site, then try again.';
        setError(msg);
        setState('disconnected');
        return { ok: false, error: msg };
      }

      // 2. Opt the push subscription in (this is the step that was missing).
      await OneSignal.User.PushSubscription.optIn();

      // 3. Wait for the subscription id to register.
      let subId = OneSignal.User.PushSubscription.id;
      for (let i = 0; i < 16 && !subId; i++) {
        await sleep(500);
        subId = OneSignal.User.PushSubscription.id;
      }
      if (!subId) {
        const msg = 'Push didn’t finish registering. Please try again.';
        setError(msg);
        setState('disconnected');
        return { ok: false, error: msg };
      }

      // 4. Tag the device with the wallet — server-side sends target this tag.
      if (wallet) {
        try {
          OneSignal.User.addTag('walletAddress', wallet);
        } catch {
          /* non-fatal */
        }
      }

      // 5. Register with our backend (best-effort; tag targeting works regardless).
      if (wallet) {
        try {
          const token = await getAccessToken();
          await fetch('/api/notifications/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ walletAddress: wallet, playerId: subId }),
          });
        } catch {
          /* non-fatal */
        }
      }

      setState('connected');
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not connect push notifications.';
      setError(msg);
      setState(readConnected() ? 'connected' : 'disconnected');
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }, [wallet, getAccessToken]);

  const disconnect = useCallback(async (): Promise<PushActionResult> => {
    setBusy(true);
    setError(null);
    try {
      await OneSignal.User.PushSubscription.optOut();
      if (wallet) {
        try {
          OneSignal.User.removeTag('walletAddress');
        } catch {
          /* ignore */
        }
      }
      setState('disconnected');
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not disconnect.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  return { state, busy, error, connect, disconnect };
}
