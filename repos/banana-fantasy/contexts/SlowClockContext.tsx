'use client';

/**
 * Client access to the slow-draft clock switch (lib/slowClock.ts).
 * Renders LEGACY copy on first paint, then ONE fetch of /api/config/slow-clock
 * on mount (CDN-cached 60s). Nothing here re-fetches, polls, or depends on
 * state that changes — rule #0 safe.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  LEGACY_SLOW_CLOCK,
  normalizeSlowClockConfig,
  slowClockCopy,
  type SlowClockConfig,
  type SlowClockCopy,
} from '@/lib/slowClock';
import { setSlowDraftPauseEndHour, setSlowDraftPauseStartHour } from '@/utils/slowDraftClock';

interface SlowClockValue {
  config: SlowClockConfig;
  copy: SlowClockCopy;
}

const SlowClockCtx = createContext<SlowClockValue>({
  config: LEGACY_SLOW_CLOCK,
  copy: slowClockCopy(LEGACY_SLOW_CLOCK),
});

export function SlowClockProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SlowClockConfig>(LEGACY_SLOW_CLOCK);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/slow-clock', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!cancelled && raw) {
          const cfg = normalizeSlowClockConfig(raw);
          setSlowDraftPauseEndHour(cfg.pauseEndHour);
          setSlowDraftPauseStartHour(cfg.pauseStartHour);
          setConfig(cfg);
        }
      })
      .catch(() => { /* legacy stays */ });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<SlowClockValue>(() => ({ config, copy: slowClockCopy(config) }), [config]);
  return <SlowClockCtx.Provider value={value}>{children}</SlowClockCtx.Provider>;
}

/** `{ config, copy }` — see SlowClockCopy for every phrasing of the pick clock. */
export function useSlowClock(): SlowClockValue {
  return useContext(SlowClockCtx);
}
