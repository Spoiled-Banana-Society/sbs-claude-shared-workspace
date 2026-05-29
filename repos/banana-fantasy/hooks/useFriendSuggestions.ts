'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { PublicUser } from './useFriends';

/**
 * "People you recently drafted with" suggestions for the Messages page.
 * Fetches once when enabled (these don't change minute-to-minute, so no
 * polling) and lets the caller optimistically drop a card once a request
 * is sent.
 *
 * Render-loop safety: the fetch effect depends on `enabled` ONLY and reaches
 * the fetcher through a ref, so Privy's churning hook identity can't re-fire
 * it per render. See the Rule #0 self-DDoS note in CLAUDE.md.
 */
export function useFriendSuggestions(enabled: boolean): {
  suggestions: PublicUser[];
  loading: boolean;
  dismiss: (wallet: string) => void;
  refresh: () => Promise<void>;
} {
  const privy = usePrivy();
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    if (!enabled) return;
    try {
      const token = await privy.getAccessToken();
      if (!token) return;
      const res = await fetch('/api/friends/suggestions', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { suggestions?: PublicUser[] };
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
    } catch {
      /* network blip — leave whatever we had */
    } finally {
      setLoading(false);
    }
  }, [enabled, privy]);

  const fetchRef = useRef(fetchOnce);
  useEffect(() => { fetchRef.current = fetchOnce; }, [fetchOnce]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    void fetchRef.current();
  }, [enabled]);

  const dismiss = useCallback((wallet: string) => {
    setSuggestions((prev) => prev.filter((u) => u.walletAddress.toLowerCase() !== wallet.toLowerCase()));
  }, []);

  return { suggestions, loading, dismiss, refresh: fetchOnce };
}
