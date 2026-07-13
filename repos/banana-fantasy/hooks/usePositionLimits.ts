'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import {
  applyDefaults,
  DEFAULT_LIMITS_ENABLED,
  DEFAULT_POSITION_LIMITS,
  POSITIONS,
  type Position,
  type PositionLimits,
} from '@/lib/positionLimits';

// Per-user auto-draft positional caps. Mirrors useNotificationOptIn's
// shape — fetches on mount, exposes setters that optimistically update
// local state and POST to the API, falls back to defaults when there's
// no wallet or the read fails.
//
// `enabled` is a master on/off for the caps. The draft engine reads it when
// the draft room loads, so toggling it does NOT change a draft you're already
// in — only drafts you enter afterward.

interface UsePositionLimitsResult {
  limits: PositionLimits;
  enabled: boolean;
  loaded: boolean;
  saving: boolean;
  setLimit: (pos: Position, n: number) => void;
  setAll: (next: PositionLimits) => void;
  setEnabled: (on: boolean) => void;
  resetToDefaults: () => void;
}

export function usePositionLimits(): UsePositionLimitsResult {
  const { user } = useAuth();
  const { getAccessToken } = usePrivy();
  const walletAddress = (user?.walletAddress ?? '').toLowerCase();
  const [limits, setLimits] = useState<PositionLimits>(DEFAULT_POSITION_LIMITS);
  const [enabled, setEnabledState] = useState<boolean>(DEFAULT_LIMITS_ENABLED);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Mirror latest state into refs so the setters can persist BOTH limits and
  // enabled together without stale-closure races.
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Throttle pending writes to one in-flight POST per save call so rapid
  // stepper clicks don't race past each other.
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setLimits(DEFAULT_POSITION_LIMITS);
      setEnabledState(DEFAULT_LIMITS_ENABLED);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/user-positional-limits?walletAddress=${encodeURIComponent(walletAddress)}`);
        if (!res.ok) throw new Error(`limits fetch failed: ${res.status}`);
        const data = (await res.json()) as { limits?: Partial<Record<string, number>>; enabled?: boolean };
        if (cancelled) return;
        setLimits(applyDefaults(data?.limits));
        setEnabledState(data?.enabled !== false);
      } catch {
        if (!cancelled) {
          setLimits(DEFAULT_POSITION_LIMITS);
          setEnabledState(DEFAULT_LIMITS_ENABLED);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const persist = useCallback(
    async (nextLimits: PositionLimits, nextEnabled: boolean) => {
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
            body: JSON.stringify({ walletAddress, ...nextLimits, enabled: nextEnabled }),
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
      const next = { ...limitsRef.current, [pos]: n };
      setLimits(next);
      void persist(next, enabledRef.current);
    },
    [persist],
  );

  const setAll = useCallback(
    (next: PositionLimits) => {
      setLimits(next);
      void persist(next, enabledRef.current);
    },
    [persist],
  );

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      void persist(limitsRef.current, on);
    },
    [persist],
  );

  const resetToDefaults = useCallback(() => {
    setLimits(DEFAULT_POSITION_LIMITS);
    void persist(DEFAULT_POSITION_LIMITS, enabledRef.current);
  }, [persist]);

  // Sanity: ensure callers only see the exact known positions (QB/RB1/RB2/
  // WR1/WR2/TE/DST) even if someone passes a foreign key in.
  void POSITIONS;

  return { limits, enabled, loaded, saving, setLimit, setAll, setEnabled, resetToDefaults };
}
