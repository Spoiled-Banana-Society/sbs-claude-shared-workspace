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
    // Capture the previous value so we can revert if the POST fails —
    // otherwise the UI would silently disagree with the persisted state
    // on the next page load.
    let previous: string | undefined;
    setNicknames(prev => {
      previous = prev[leagueId];
      const next = { ...prev };
      if (trimmed) next[leagueId] = trimmed;
      else delete next[leagueId];
      return next;
    });
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/owner/team-nicknames', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ walletAddress, leagueId, name: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text}`);
      }
    } catch (err) {
      console.warn('[teamNicknames] save failed — reverting', err);
      // Revert optimistic update.
      setNicknames(prev => {
        const next = { ...prev };
        if (previous === undefined) delete next[leagueId];
        else next[leagueId] = previous;
        return next;
      });
    } finally {
      setSaving(false);
    }
  }, [walletAddress, getAccessToken]);

  return { nicknames, loaded, saving, setNickname };
}
