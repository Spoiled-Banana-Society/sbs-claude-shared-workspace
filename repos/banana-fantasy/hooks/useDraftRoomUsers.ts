'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useSWRLike } from '@/hooks/useSWRLike';
import { subscribeIdentityChange } from '@/lib/identityBus';
import type { Ripeness } from '@/types';

export interface DraftRoomUser {
  displayName: string | null;
  imageUrl: string | null;
  equippedBadge: string | null;
  /** Ripeness tier — colors the default banana when no badge is equipped. */
  ripeness?: Ripeness | null;
}

export type DraftRoomUsersMap = Record<string, DraftRoomUser>;

const EMPTY: DraftRoomUsersMap = {};

// Retry transient failures within a single fetch attempt. A flaky phone
// connection (or a brief server hiccup) used to make the whole board fall back
// to wallet / "Banana#####" names for the rest of the draft, because a failed
// request was returned as an empty-but-successful result and never retried.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [300, 800]; // backoff before attempts 2 and 3

// setTimeout-based delay that bails immediately if the caller aborts
// (component unmount / wallet-list change), so we never keep retrying a
// request nobody is waiting on.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchUsers(wallets: string[], signal: AbortSignal): Promise<DraftRoomUsersMap> {
  if (wallets.length === 0) return EMPTY;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Bounded backoff between attempts. delay() rejects on abort, which
      // breaks the loop via the catch below.
      await delay(RETRY_DELAYS_MS[attempt - 1] ?? 800, signal);
    }
    try {
      const res = await fetch('/api/users/display-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets }),
        signal,
      });
      if (!res.ok) {
        // Treat any non-OK as transient and retry; give up after the last attempt.
        lastErr = new Error(`display-batch responded ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { users?: DraftRoomUsersMap };
      return body.users ?? EMPTY;
    } catch (err) {
      // Abort = caller cancelled; stop and propagate, don't burn retries.
      if (signal.aborted) throw err;
      lastErr = err;
    }
  }

  // All attempts failed. Throw (instead of returning EMPTY) so useSWRLike
  // records this as an error rather than caching an empty map as a successful
  // result — that way a later remount / page reload re-fetches cleanly instead
  // of being stuck showing wallets for the rest of the session.
  throw lastErr ?? new Error('display-batch failed');
}

/**
 * Batch-resolves display info (username, pfp, equipped badge) for a list
 * of draft-room player wallets. Bot ownerIds (prefix `bot-`) are dropped
 * before the request — server short-circuits them too.
 *
 * Cached so re-renders during a draft (every tick) don't re-fetch.
 */
export function useDraftRoomUsers(walletsRaw: (string | undefined | null)[]): DraftRoomUsersMap {
  const wallets = Array.from(new Set(
    walletsRaw
      .filter((w): w is string => typeof w === 'string' && w.length > 0)
      .map(w => w.toLowerCase())
      .filter(w => !w.startsWith('bot-')),
  )).sort();

  const key = wallets.length > 0 ? `users-display:${wallets.join(',')}` : null;
  const { data, mutate } = useSWRLike<DraftRoomUsersMap>(
    key,
    ({ signal }) => fetchUsers(wallets, signal),
    // Live-feel without a socket: re-pull on focus, and poll every 30s (paused
    // while the tab is hidden) so a name/pfp another player edits shows up for
    // everyone within ~30s.
    { fallbackData: EMPTY, revalidateOnFocus: true, refreshInterval: 30_000 },
  );

  // Instant path for the EDITOR's own screens: when this client saves a name/pfp
  // edit, refetch immediately if the changed wallet is one we're displaying (no
  // wait for the 30s poll). Other clients still get it via the poll above.
  const walletsKey = wallets.join(',');
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  useEffect(() => {
    const set = new Set(walletsKey ? walletsKey.split(',') : []);
    return subscribeIdentityChange((w) => { if (set.has(w)) void mutateRef.current(); });
  }, [walletsKey]);

  // Sticky avatars: once we've resolved a real pfp for a wallet, never let a
  // later poll downgrade it back to null (which renders as the default banana).
  // The /api/users/display-batch fallback hits the Go API with a 4s timeout; a
  // single slow/failed poll returns imageUrl:null as a SUCCESSFUL 200, which
  // used to blink every board + top-strip avatar back to bananas every ~30s for
  // the rest of the draft. We keep the last-known-good imageUrl per wallet.
  // Trade-off: if a user clears their pfp mid-draft it stays until reload —
  // acceptable; a flicker-to-banana on every poll is far worse during a live
  // draft. Only imageUrl is made sticky; name/badge/ripeness pass through live
  // (displayName is never null from the API, so it can't get stuck).
  const stickyPfpRef = useRef<Record<string, string>>({});
  return useMemo(() => {
    const out: DraftRoomUsersMap = {};
    for (const w of Object.keys(data)) {
      const next = data[w];
      const img = next.imageUrl ?? stickyPfpRef.current[w] ?? null;
      if (img) stickyPfpRef.current[w] = img;
      out[w] = { ...next, imageUrl: img };
    }
    return out;
  }, [data]);
}
