'use client';

// Online-dot presence (Boris 2026-06-11).
//
//  • usePresenceHeartbeat — mounted ONCE app-wide (SocialNotifier): pings
//    /api/presence/ping every 45s while the tab is visible, plus immediately
//    on login/focus. Rule #0: Privy lives in a ref; effect deps are scalars.
//  • usePresenceMap — any component rendering dots; all instances share ONE
//    RTDB listener (lib/api/firebase singleton).

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { subscribePresenceMap, PRESENCE_ONLINE_WINDOW_MS } from '@/lib/api/firebase';

const HEARTBEAT_MS = 45_000;

export function usePresenceHeartbeat(walletAddress: string | null | undefined): void {
  const privy = usePrivy();
  const privyRef = useRef(privy);
  privyRef.current = privy;

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    const ping = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      try {
        const token = await privyRef.current.getAccessToken();
        if (!token) return;
        await fetch('/api/presence/ping', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort */ }
    };
    void ping();
    const id = setInterval(() => { void ping(); }, HEARTBEAT_MS);
    const onFocus = () => { if (document.visibilityState !== 'hidden') void ping(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [walletAddress]);
}

export function usePresenceMap(): { isOnline: (wallet: string | null | undefined) => boolean } {
  const [map, setMap] = useState<Record<string, number>>({});

  useEffect(() => subscribePresenceMap(setMap), []);

  // Re-evaluate "within 90s" periodically so dots fade without a new event.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const isOnline = (wallet: string | null | undefined): boolean => {
    if (!wallet) return false;
    const last = map[wallet.toLowerCase()];
    return typeof last === 'number' && Date.now() - last < PRESENCE_ONLINE_WINDOW_MS;
  };
  return { isOnline };
}
