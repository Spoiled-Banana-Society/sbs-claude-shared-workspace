'use client';

import type { UserExposure } from '@/lib/exposureUtils';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';

export function useExposure(opts?: { userId?: string }) {
  const { user } = useAuth();
  const userId = opts?.userId ?? user?.id;

  return useSWRLike<UserExposure | null>(
    userId ? `exposure:${userId}` : null,
    ({ signal }) => fetchJson<UserExposure>(`/api/exposure/${userId}`, { signal }),
    {
      enabled: !!userId,
      fallbackData: null,
      // Live-feel: the server recomputes exposure from completed drafts on each
      // GET (2s throttle), so refetch when the user returns to the tab and poll
      // every 20s while open. Finishing a draft → the data is fresh here without
      // a manual reload (Boris 2026-06-13).
      revalidateOnFocus: true,
      refreshInterval: 20_000,
    },
  );
}
