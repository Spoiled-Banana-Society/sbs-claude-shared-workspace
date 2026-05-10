'use client';

import { useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useSWRLike } from '@/hooks/useSWRLike';
import { fetchJson } from '@/lib/appApiClient';
import type { Badge } from '@/types';

interface BadgesResponse {
  catalog: Badge[];
  unlocked: { id: string; unlockedAt: string | null }[];
  equipped: string | null;
}

const FALLBACK: BadgesResponse = { catalog: [], unlocked: [], equipped: null };

/**
 * Read + manage the current user's badges. Returns the full catalog
 * (always populated from the server) so the UI can render every badge,
 * a Set of unlocked ids, and the equipped badge id.
 *
 * `equipBadge(badgeId | null)` POSTs to /api/badges/equip and refetches
 * on success. Mutate `useAuth` so other components see the new value
 * without a page reload.
 */
export function useBadges(opts?: { userId?: string }) {
  const { user, updateUser } = useAuth();
  const { getAccessToken } = usePrivy();
  const userId = opts?.userId ?? user?.id;

  const swr = useSWRLike<BadgesResponse>(
    userId ? `badges:${userId}` : 'badges:anon',
    ({ signal }) => fetchJson<BadgesResponse>('/api/badges', {
      signal,
      query: userId ? { userId } : {},
    }),
    { fallbackData: FALLBACK },
  );

  const equipBadge = useCallback(async (badgeId: string | null) => {
    const token = await getAccessToken();
    if (!token) return { ok: false, reason: 'not authenticated' };
    const res = await fetch('/api/badges/equip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ badgeId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: data.error || `HTTP ${res.status}` };
    }
    // Optimistic local update so all surfaces re-render with the new
    // equipped badge immediately.
    updateUser({ equippedBadge: badgeId });
    void swr.mutate();
    return { ok: true };
  }, [getAccessToken, swr, updateUser]);

  // Server tells us which earned badges are unlocked. Layer on
  // `alwaysUnlocked` cosmetics (e.g. NFL team flair) from the catalog so
  // they're equippable without per-user Firestore writes.
  const unlockedSet = new Set([
    ...swr.data.unlocked.map(u => u.id),
    ...swr.data.catalog.filter(b => b.alwaysUnlocked).map(b => b.id),
  ]);

  // Prefer the user's locally-updated equippedBadge for instant click
  // feedback. Falls back to the server-side value during initial load
  // (when the user object hasn't been hydrated yet).
  const equipped = (typeof user?.equippedBadge !== 'undefined')
    ? user.equippedBadge ?? null
    : swr.data.equipped;

  return {
    catalog: swr.data.catalog,
    unlockedIds: unlockedSet,
    equipped,
    isLoading: swr.isLoading,
    refresh: swr.mutate,
    equipBadge,
  };
}
