'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

/**
 * Has the user set up Draft Alerts yet? True once they've changed any toggle on
 * the alerts page (server-stamped `prefs.configured`). The draft page uses this
 * to drop the "Draft Alerts" prompt once they know where it lives.
 *
 * Re-checks on window focus so returning from the alerts page reflects the new
 * state in real time. Render-loop safe: getAccessToken lives in a ref, effect
 * deps are the stable wallet only (CLAUDE.md rule).
 */
export function useDraftAlertsConfigured(): { configured: boolean | null } {
  const { walletAddress } = useAuth();
  const { getAccessToken } = usePrivy();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  useEffect(() => {
    if (!walletAddress) { setConfigured(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const token = await tokenRef.current?.();
        if (!token) return;
        const res = await fetch('/api/notifications/profile', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setConfigured(!!data?.prefs?.configured);
      } catch { /* best-effort — default to showing the prompt */ }
    };
    void load();
    const onFocus = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [walletAddress]);

  return { configured };
}
