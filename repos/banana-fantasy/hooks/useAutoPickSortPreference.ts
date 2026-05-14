'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';

export type SortPreference = 'adp' | 'rank';
const DEFAULT_PREFERENCE: SortPreference = 'adp';

interface UseAutoPickSortPreferenceResult {
  preference: SortPreference;
  loaded: boolean;
  saving: boolean;
  setPreference: (pref: SortPreference) => void;
}

/**
 * Per-user default for the auto-pick sort order (ADP vs the user's own
 * rankings). Mirrors usePositionLimits — fetches on mount, exposes a
 * setter that optimistically updates local state and POSTs to the API.
 *
 * Applied on draft-room entry: if the per-draft sortBy from the Go API
 * is still the default 'ADP' AND the user's global preference is 'rank',
 * the draft starts in rank mode.
 */
export function useAutoPickSortPreference(): UseAutoPickSortPreferenceResult {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const walletAddress = (user?.walletAddress ?? '').toLowerCase();
  const [preference, setPreferenceState] = useState<SortPreference>(DEFAULT_PREFERENCE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setPreferenceState(DEFAULT_PREFERENCE);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/user-sort-preference?walletAddress=${encodeURIComponent(walletAddress)}`);
        if (!res.ok) throw new Error(`sort pref fetch failed: ${res.status}`);
        const data = (await res.json()) as { preference?: SortPreference };
        if (cancelled) return;
        if (data?.preference === 'adp' || data?.preference === 'rank') {
          setPreferenceState(data.preference);
        }
      } catch {
        if (!cancelled) setPreferenceState(DEFAULT_PREFERENCE);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const setPreference = useCallback(
    (pref: SortPreference) => {
      setPreferenceState(pref);
      if (!walletAddress) return;
      void (async () => {
        setSaving(true);
        try {
          const token = await getAccessToken();
          await fetch('/api/user-sort-preference', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ walletAddress, preference: pref }),
          });
        } catch (err) {
          console.warn('[autoPickSortPreference] save failed', err);
        } finally {
          setSaving(false);
        }
      })();
    },
    [walletAddress, getAccessToken],
  );

  return { preference, loaded, saving, setPreference };
}
