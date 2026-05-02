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
    // Initial read. The "purge unstamped" pass that used to live here was
    // removed because the join flow sometimes writes a draft with an
    // empty/undefined liveWalletAddress (Privy hydration race when the
    // home-page Enter button fires before user.walletAddress resolves),
    // and the purge then deleted the user's real, just-joined draft on
    // the next /drafting mount — making it flicker in and disappear.
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
