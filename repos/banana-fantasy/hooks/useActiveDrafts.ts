'use client';

import { useState, useEffect, useCallback } from 'react';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';

/**
 * Reactive hook that subscribes to the draftStore and re-reads on
 * window focus so the drafting page always reflects live state.
 *
 * Returns ALL drafts in localStorage. Wallet-scoping is the caller's
 * responsibility — `useDraftingPageState` already filters by the live
 * Privy wallet. Doing the filter twice in two places (here against
 * `banana-last-wallet` localStorage, there against `user.walletAddress`)
 * caused drafts to flicker in then disappear when the two values were
 * briefly out of sync (Privy hydration race, wallet swap, case mismatch).
 *
 * Single source of truth: the caller's wallet filter.
 */
export function useActiveDrafts(): DraftState[] {
  const [drafts, setDrafts] = useState<DraftState[]>(() => draftStore.getActiveDrafts());

  const refresh = useCallback(() => {
    setDrafts(draftStore.getActiveDrafts());
  }, []);

  useEffect(() => {
    // Purge legacy rows that have no wallet stamp — they're unattributable
    // and can't be safely shown to any wallet. The downstream filter in
    // useDraftingPageState allows unstamped through, so without this purge
    // stale prior-session rows could leak into a new user's My Drafts.
    try {
      const all = draftStore.getActiveDrafts();
      const stale = all.filter(d => !d.liveWalletAddress);
      for (const d of stale) draftStore.removeDraft(d.id);
    } catch { /* ignore */ }

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
