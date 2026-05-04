'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import {
  applyDefaults,
  DEFAULT_POSITION_LIMITS,
  POSITIONS,
  type Position,
  type PositionLimits,
} from '@/lib/positionLimits';

// Per-user auto-draft positional caps. Mirrors useNotificationOptIn's
// shape — fetches on mount, exposes setters that optimistically update
// local state and POST to the API, falls back to defaults when there's
// no wallet or the read fails.

interface UsePositionLimitsResult {
  limits: PositionLimits;
  loaded: boolean;
  saving: boolean;
  setLimit: (pos: Position, n: number) => void;
  setAll: (next: PositionLimits) => void;
  resetToDefaults: () => void;
}

export function usePositionLimits(): UsePositionLimitsResult {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const walletAddress = (user?.walletAddress ?? '').toLowerCase();
  const [limits, setLimits] = useState<PositionLimits>(DEFAULT_POSITION_LIMITS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Throttle pending writes to one in-flight POST per save call so rapid
  // stepper clicks don't race past each other.
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setLimits(DEFAULT_POSITION_LIMITS);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/user-positional-limits?walletAddress=${encodeURIComponent(walletAddress)}`);
        if (!res.ok) throw new Error(`limits fetch failed: ${res.status}`);
        const data = (await res.json()) as { limits?: Partial<Record<string, number>> };
        if (cancelled) return;
        setLimits(applyDefaults(data?.limits));
      } catch {
        if (!cancelled) setLimits(DEFAULT_POSITION_LIMITS);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const persist = useCallback(
    async (next: PositionLimits) => {
      if (!walletAddress) return;
      setSaving(true);
      const run = (async () => {
        try {
          const token = await getAccessToken();
          await fetch('/api/user-positional-limits', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ walletAddress, ...next }),
          });
        } catch (err) {
          console.warn('[positionLimits] save failed', err);
        } finally {
          setSaving(false);
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = run;
      await run;
    },
    [walletAddress, getAccessToken],
  );

  const setLimit = useCallback(
    (pos: Position, n: number) => {
      setLimits(prev => {
        const next = { ...prev, [pos]: n };
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const setAll = useCallback(
    (next: PositionLimits) => {
      setLimits(next);
      void persist(next);
    },
    [persist],
  );

  const resetToDefaults = useCallback(() => {
    setLimits(DEFAULT_POSITION_LIMITS);
    void persist(DEFAULT_POSITION_LIMITS);
  }, [persist]);

  // Sanity: ensure callers only see the exact 5 known positions even if
  // someone passes a foreign key in.
  void POSITIONS;

  return { limits, loaded, saving, setLimit, setAll, resetToDefaults };
}
