'use client';

import { useSWRLike } from '@/hooks/useSWRLike';

export interface DraftRoomUser {
  displayName: string | null;
  imageUrl: string | null;
  equippedBadge: string | null;
}

export type DraftRoomUsersMap = Record<string, DraftRoomUser>;

const EMPTY: DraftRoomUsersMap = {};

async function fetchUsers(wallets: string[], signal: AbortSignal): Promise<DraftRoomUsersMap> {
  if (wallets.length === 0) return EMPTY;
  const res = await fetch('/api/users/display-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallets }),
    signal,
  });
  if (!res.ok) return EMPTY;
  const body = (await res.json()) as { users?: DraftRoomUsersMap };
  return body.users ?? EMPTY;
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
  const { data } = useSWRLike<DraftRoomUsersMap>(
    key,
    ({ signal }) => fetchUsers(wallets, signal),
    { fallbackData: EMPTY },
  );

  return data;
}
