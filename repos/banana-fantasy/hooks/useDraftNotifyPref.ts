'use client';

/**
 * Per-speed draft turn-alert preference, usable from inside the draft room.
 *
 * Draft pick notifications are split by draft speed — `events.pickFast` and
 * `events.pickSlow` — and stored PER-WALLET in Firestore via
 * /api/notifications/profile. That means:
 *   - whatever the user sets PERSISTS across every draft (it's their account
 *     preference, not a per-draft localStorage flag), and
 *   - fast and slow are INDEPENDENT — toggling one never touches the other
 *     (Firestore set(..., {merge:true}) deep-merges the events map).
 *
 * "Enabled" for a given speed = the push channel is connected AND that speed's
 * pick alert isn't disabled. Enabling connects the OneSignal push subscription
 * (browser permission + opt-in; that same flow sets channels.push:true
 * server-side) and flips the speed's event pref on. Disabling only flips that
 * one speed's pref off, leaving push + the other speed untouched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import type { PushActionResult } from '@/hooks/usePushSubscription';

export type DraftSpeed = 'fast' | 'slow';

export function useDraftNotifyPref(speed: DraftSpeed) {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const wallet = user?.walletAddress?.toLowerCase() ?? null;
  const push = usePushSubscription();
  const eventKey = speed === 'slow' ? 'pickSlow' : 'pickFast';

  const [enabled, setEnabled] = useState<boolean | null>(null); // null = loading
  const [busy, setBusy] = useState(false);

  // Rule #0: stash the Privy-derived token getter in a ref so the load effect's
  // deps stay scalar (wallet, eventKey) and it never re-fires per render.
  const tokenRef = useRef(getAccessToken);
  useEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  const load = useCallback(async () => {
    if (!wallet) {
      setEnabled(null);
      return;
    }
    try {
      const token = await tokenRef.current();
      const res = await fetch('/api/notifications/profile', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const prefs = (data as { prefs?: { channels?: Record<string, boolean>; events?: Record<string, boolean> } }).prefs;
      const pushOn = prefs?.channels?.push === true;
      const evOn = prefs?.events?.[eventKey] !== false; // default on
      setEnabled(pushOn && evOn);
    } catch {
      setEnabled(false);
    }
  }, [wallet, eventKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (): Promise<PushActionResult> => {
    const next = !(enabled ?? false);
    setBusy(true);
    try {
      // Enabling: make sure push is actually connected so alerts deliver
      // (connect() also flips channels.push:true server-side).
      if (next && push.state !== 'connected') {
        const r = await push.connect();
        if (!r.ok) return r;
      }
      const token = await tokenRef.current();
      const res = await fetch('/api/notifications/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ events: { [eventKey]: next } }),
      });
      if (!res.ok) return { ok: false, error: 'Could not save your preference.' };
      setEnabled(next);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error saving preference.' };
    } finally {
      setBusy(false);
    }
  }, [enabled, eventKey, push]);

  return {
    enabled: enabled ?? false,
    loading: enabled === null,
    busy: busy || push.busy,
    toggle,
  };
}
