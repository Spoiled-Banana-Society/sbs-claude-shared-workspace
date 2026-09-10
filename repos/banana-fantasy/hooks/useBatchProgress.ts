import { useEffect, useState, useCallback } from 'react';
import { type BatchProgress } from '@/lib/api/leagues';
import { promosRetired } from '@/lib/draftTypes';

interface UseBatchProgressReturn {
  data: BatchProgress | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Real-time batch progress stream. Subscribes to the SSE endpoint at
 * /api/league/batchProgress/stream which is itself listening to the
 * Firestore drafts/draftTracker doc via onSnapshot. Each push lands in
 * the browser within ~200ms of the Go API writing JP/HOF arrays at a
 * draft fill — every user sees the "X JP / Y HOF remaining" header
 * decrement at the same moment the slot machine reveals the type, no
 * 30s polling lag.
 *
 * Why this matters: in the last few drafts of a batch with the JP
 * still unhit, users will rush to enter. If the header lags, someone
 * could pay $25 for a draft AFTER the JP just hit elsewhere and feel
 * cheated. Real-time eliminates the race.
 *
 * Falls back to a single fetch if EventSource is unavailable (older
 * browsers, server-side rendering, etc.) but every modern browser
 * supports SSE natively. No reconnect logic needed — EventSource auto-
 * reconnects on transient errors.
 */
export function useBatchProgress(): UseBatchProgressReturn {
  const [data, setData] = useState<BatchProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    // Forces a fresh EventSource connection. Rarely needed (the stream
    // already pushes updates) but exposed for any consumer that wants
    // to manually re-sync.
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Season closed (2026-09-10): the odds strip is gone, so never open the
    // stream — it was still being opened on every page for every visitor.
    if (promosRetired()) { setIsLoading(false); return; }
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      // SSR / unsupported browser — degrade to a single fetch.
      let cancelled = false;
      fetch('/league/batchProgress', { signal: AbortSignal.timeout(5000) }).catch(() => null)
        .then(async (res) => {
          if (cancelled || !res || !res.ok) {
            setIsLoading(false);
            return;
          }
          const body = (await res.json()) as BatchProgress;
          setData(body);
          setIsLoading(false);
        });
      return () => { cancelled = true; };
    }

    const url = '/api/league/batchProgress/stream';
    const es = new EventSource(url);

    const handle = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as BatchProgress;
        setData(payload);
        setIsLoading(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('parse error'));
      }
    };

    es.addEventListener('snapshot', handle);
    es.addEventListener('update', handle);

    es.onerror = (ev) => {
      // EventSource auto-reconnects on transient failures. Only surface
      // a hard failure if we never got initial data.
      if (es.readyState === EventSource.CLOSED) {
        setError(new Error('Stream closed'));
      }
      void ev;
    };

    return () => {
      es.removeEventListener('snapshot', handle);
      es.removeEventListener('update', handle);
      es.close();
    };
  }, [refreshTick]);

  return { data, isLoading, error, refresh };
}
