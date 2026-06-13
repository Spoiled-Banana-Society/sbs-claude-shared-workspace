'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMockDataEnabled } from '@/lib/mockMode';

type CacheEntry<T> = {
  data: T | null;
  error: unknown;
  updatedAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export interface UseSWRLikeOptions<T> {
  enabled?: boolean;
  fallbackData: T;
  /** When true, the last successful payload is mirrored to localStorage and
   *  hydrated on mount — so a HARD page refresh paints instantly from the last
   *  snapshot (then revalidates live), instead of showing a skeleton while the
   *  network round-trips. Opt-in per hook (data must be JSON-serializable). */
  persist?: boolean;
  /** Refetch when the tab regains focus / becomes visible. Opt-in. Makes a
   *  view feel live without a websocket — you come back and it's fresh. */
  revalidateOnFocus?: boolean;
  /** Poll every N ms while mounted (0/undefined = off). Skips ticks while the
   *  tab is hidden so we don't hammer the server in the background. Opt-in. */
  refreshInterval?: number;
}

function lsKey(key: string): string { return `swr:${key}`; }

export interface UseSWRLikeResult<T> {
  data: T;
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
  mutate: () => Promise<void>;
  usingMockData: boolean;
}

/**
 * Minimal SWR-like hook:
 * - returns cached data immediately when available
 * - revalidates on mount
 * - provides mutate() to refetch
 */
export function useSWRLike<T>(
  key: string | null,
  fetcher: (ctx: { signal: AbortSignal }) => Promise<T>,
  options: UseSWRLikeOptions<T>,
): UseSWRLikeResult<T> {
  const usingMockData = isMockDataEnabled();

  const enabled = (options.enabled ?? true) && !!key && !usingMockData;
  const persist = options.persist ?? false;

  const cached = useMemo(() => {
    if (!key) return null;
    let entry = cache.get(key) as CacheEntry<T> | undefined;
    // Hard-refresh hydration: seed the in-memory cache from localStorage so the
    // first paint has data (no skeleton) before the network revalidation lands.
    if (!entry && persist && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(lsKey(key));
        if (raw) {
          entry = { data: JSON.parse(raw) as T, error: null, updatedAt: 0 };
          cache.set(key, entry);
        }
      } catch { /* ignore corrupt/oversized localStorage */ }
    }
    return entry ?? null;
  }, [key, persist]);

  const [data, setData] = useState<T>(() => (cached?.data ?? null) ?? options.fallbackData);
  const [error, setError] = useState<unknown>(() => cached?.error ?? null);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  const isFirstLoadRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fallbackRef = useRef(options.fallbackData);
  fallbackRef.current = options.fallbackData;

  const runFetch = useCallback(async () => {
    if (!enabled || !key) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setData(fallbackRef.current);
      setError(null);
      setIsValidating(false);
      return;
    }

    controllerRef.current?.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    setIsValidating(true);
    try {
      const next = await fetcherRef.current({ signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      cache.set(key, { data: next, error: null, updatedAt: Date.now() });
      if (persist && typeof window !== 'undefined') {
        try { window.localStorage.setItem(lsKey(key), JSON.stringify(next)); } catch { /* quota/serialize — non-fatal */ }
      }
      setData(next);
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      cache.set(key, { data: fallbackRef.current, error: err, updatedAt: Date.now() });
      setData(fallbackRef.current);
      setError(err);
    } finally {
      if (controllerRef.current === ctrl) {
        controllerRef.current = null;
        setIsValidating(false);
      }
    }
  }, [enabled, key, persist]);

  useEffect(() => {
    void runFetch();

    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [key, enabled, runFetch]);

  // Live-feel revalidation (opt-in). runFetch is stable (deps: enabled/key/
  // persist) and carries no Privy-derived identity, so listing it here can't
  // trigger the render-loop fetch storm the CLAUDE.md rule warns about.
  const revalidateOnFocus = options.revalidateOnFocus ?? false;
  const refreshInterval = options.refreshInterval ?? 0;

  useEffect(() => {
    if (!enabled || !revalidateOnFocus || typeof window === 'undefined') return;
    const onFocus = () => { if (document.visibilityState !== 'hidden') void runFetch(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [enabled, revalidateOnFocus, runFetch]);

  useEffect(() => {
    if (!enabled || refreshInterval <= 0 || typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return; // pause in background
      void runFetch();
    }, refreshInterval);
    return () => window.clearInterval(id);
  }, [enabled, refreshInterval, runFetch]);

  const isLoading = useMemo(() => {
    if (!enabled) return false;
    if (!key) return false;
    // Consider it loading only on the very first load when we had no cache.
    return isFirstLoadRef.current && !cached;
  }, [enabled, key, cached]);

  useEffect(() => {
    isFirstLoadRef.current = false;
  }, []);

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate: runFetch,
    usingMockData,
  };
}
