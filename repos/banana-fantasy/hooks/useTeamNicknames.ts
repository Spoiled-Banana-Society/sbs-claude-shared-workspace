'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

// Per-user nicknames for the leagues you're in. Keyed by leagueId, lives
// in /api/owner/team-nicknames as a single Firestore doc per wallet.

interface UseTeamNicknamesResult {
  nicknames: Record<string, string>;
  loaded: boolean;
  saving: boolean;
  setNickname: (leagueId: string, name: string) => Promise<void>;
}

export function useTeamNicknames(): UseTeamNicknamesResult {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const walletAddress = (user?.walletAddress ?? '').toLowerCase();
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner/team-nicknames?walletAddress=${encodeURIComponent(walletAddress)}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { nicknames?: Record<string, string> };
        if (cancelled) return;
        setNicknames(data.nicknames ?? {});
      } catch {
        if (!cancelled) setNicknames({});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  const setNickname = useCallback(async (leagueId: string, name: string) => {
    if (!walletAddress || !leagueId) return;
    const trimmed = name.trim();
    // Optimistic local update so the card re-renders instantly.
    setNicknames(prev => {
      const next = { ...prev };
      if (trimmed) next[leagueId] = trimmed;
      else delete next[leagueId];
      return next;
    });
    setSaving(true);
    try {
      const token = await getAccessToken();
      await fetch('/api/owner/team-nicknames', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ walletAddress, leagueId, name: trimmed }),
      });
    } catch (err) {
      console.warn('[teamNicknames] save failed', err);
    } finally {
      setSaving(false);
    }
  }, [walletAddress, getAccessToken]);

  return { nicknames, loaded, saving, setNickname };
}
