'use client';

import { useState, useEffect, useCallback } from 'react';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';

/**
 * Reactive hook that subscribes to the draftStore and re-reads on
 * window focus so the drafting page always reflects live state.
 * Filters to only show drafts belonging to the current wallet.
 */
export function useActiveDrafts(): DraftState[] {
  const [drafts, setDrafts] = useState<DraftState[]>(() => filterByWallet(draftStore.getActiveDrafts()));

  const refresh = useCallback(() => {
    setDrafts(filterByWallet(draftStore.getActiveDrafts()));
  }, []);

  useEffect(() => {
    // One-time purge of legacy unstamped rows. Without this, the entries
    // hidden by filterByWallet still sit in localStorage forever, growing
    // the store and re-bleeding if the filter is ever softened. Safe to
    // run on every mount: if a wallet is logged in, anything missing
    // `liveWalletAddress` is unattributable and stale by definition.
    try {
      const wallet = localStorage.getItem('banana-last-wallet');
      if (wallet) {
        const all = draftStore.getActiveDrafts();
        const stale = all.filter(d => !d.liveWalletAddress);
        for (const d of stale) draftStore.removeDraft(d.id);
      }
    } catch { /* ignore */ }

    // Initial read
    refresh();

    // Pull the wallet's server-side filling seats and backfill any this device
    // never recorded locally (join on another device/session, or a raced local
    // write). Add-only + rate-limited internally, so it can't clobber live rows
    // or hammer the API. Subscriber `refresh` picks up any inserted rows.
    draftStore.hydrateActiveDrafts().catch(() => {
      // Non-fatal — the local view stays as-is if hydration fails.
    });

    // Prune drafts the backend has deleted — fires on every mount of the
    // drafting page. Conservative: only 404s + only drafts older than 30s.
    // 5xx / network errors leave the cache alone. Subscriber `refresh`
    // picks up the change automatically when the prune writes back.
    draftStore.pruneMissingDrafts().catch(() => {
      // Failures here are non-fatal — UI stays consistent without the prune.
    });

    // Subscribe to in-tab writes (same window)
    const unsub = draftStore.subscribe(refresh);

    // Listen for cross-tab writes via storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'banana-active-drafts') refresh();
    };
    window.addEventListener('storage', onStorage);

    // Re-read when window regains focus (catches anything missed), and re-pull
    // server seats — hydrate is rate-limited internally so refocus churn is safe.
    const onFocus = () => {
      refresh();
      draftStore.hydrateActiveDrafts().catch(() => {});
    };
    window.addEventListener('focus', onFocus);

    return () => {
      unsub();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return drafts;
}

function filterByWallet(drafts: DraftState[]): DraftState[] {
  if (typeof window === 'undefined') return drafts;
  const wallet = localStorage.getItem('banana-last-wallet')?.toLowerCase();
  if (!wallet) return drafts;
  // Strict wallet match. Legacy rows without `liveWalletAddress` used to be
  // allowed through here, but that meant drafts entered by any prior wallet
  // on this browser leaked into the current user's "My Drafts" view. Drop
  // them — if a draft truly belonged to this wallet, the live-sync loop
  // would have stamped it by now; if it never got stamped it's stale and
  // safe to hide. Permanently purging from localStorage is handled in the
  // wallet-load effect of useDraftingPageState.
  return drafts.filter(d => d.liveWalletAddress?.toLowerCase() === wallet);
}
