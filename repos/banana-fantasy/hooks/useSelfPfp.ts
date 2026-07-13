'use client';

import { useEffect, useState } from 'react';

/**
 * Durable memory of the logged-in user's OWN avatar.
 *
 * The two live sources of the self pfp in the draft room — the auth
 * `user.profilePicture` and the 30s `usersMap` poll — both go briefly empty
 * on their own:
 *   - `user.profilePicture` is undefined during Privy session rehydration
 *     (page reload) and when a backgrounded mobile tab momentarily reports
 *     "not authenticated" before re-resolving. It is never re-fetched on focus.
 *   - the `usersMap` poll pauses entirely while the tab is hidden (normal on a
 *     phone) and its in-memory sticky cache is wiped on any remount/reload.
 *
 * When both are empty at the same time (the common mobile case after
 * background → reopen) the avatar falls back to the banana and never recovers
 * until a fresh network round-trip repopulates a source.
 *
 * This hook fixes that by persisting the last-known-good self pfp to
 * localStorage. It is read SYNCHRONOUSLY on first render, so the avatar shows
 * immediately — before Privy or the poll come back. Pure localStorage, no
 * network: safe under the Rule #0 render-loop guard.
 *
 * Pass any live candidates (live auth pfp, usersMap self entry); the first
 * real one is remembered and returned. Returns the best-known real pfp URL, or
 * null if we have never seen one (caller falls back to the banana).
 */

export const SELF_PFP_KEY = 'banana-fantasy-self-pfp';

function isRealPfp(url: string | null | undefined): url is string {
  // A real, renderable, durable URL — not the banana placeholder and not a
  // giant inline base64 blob (those 500 the Go pfp endpoint and bloat storage).
  return !!url && url !== '/banana-profile.png' && !url.startsWith('data:');
}

function readSelfPfp(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(SELF_PFP_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a known-good self pfp to the durable cache. Call this anywhere the
 * app resolves the logged-in user's avatar (e.g. on auth resolve / profile
 * save) so the draft room already has it on a cold mobile load.
 */
export function rememberSelfPfp(url: string | null | undefined): void {
  if (typeof window === 'undefined' || !isRealPfp(url)) return;
  try {
    localStorage.setItem(SELF_PFP_KEY, url);
  } catch {
    // ignore storage errors
  }
}

export function useSelfPfp(...liveCandidates: Array<string | null | undefined>): string | null {
  const [persisted, setPersisted] = useState<string | null>(() => readSelfPfp());

  // First real live value this render, if any.
  const live = liveCandidates.find(isRealPfp) ?? null;

  useEffect(() => {
    if (live && live !== persisted) {
      setPersisted(live);
      try {
        localStorage.setItem(SELF_PFP_KEY, live);
      } catch {
        // ignore storage errors (private mode / quota)
      }
    }
  }, [live, persisted]);

  // Live source always wins (it's freshest); otherwise the durable cache.
  return live ?? persisted;
}
