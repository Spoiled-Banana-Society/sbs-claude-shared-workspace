'use client';

import { useState, useEffect, useCallback } from 'react';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';

/**
 * Reactive hook that subscribes to the draftStore and re-reads on
 * window focus so the drafting page always reflects live state.
 */
export function useActiveDrafts(): DraftState[] {
  const [drafts, setDrafts] = useState<DraftState[]>(() => draftStore.getActiveDrafts());

  const refresh = useCallback(() => {
    setDrafts(draftStore.getActiveDrafts());
  }, []);

  useEffect(() => {
    // Initial read
    refresh();

    // Subscribe to in-tab writes (same window)
    const unsub = draftStore.subscribe(refresh);

    // Listen for cross-tab writes via storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'banana-active-drafts') refresh();
    };
    window.addEventListener('storage', onStorage);

    // Re-read when window regains focus (catches anything missed)
    window.addEventListener('focus', refresh);

    return () => {
      unsub();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return drafts;
}
