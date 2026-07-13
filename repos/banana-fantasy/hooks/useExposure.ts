'use client';

import { useEffect, useState } from 'react';
import type { UserExposure } from '@/lib/exposureUtils';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';

export function useExposure(opts?: { userId?: string }) {
  const { user } = useAuth();
  const userId = opts?.userId ?? user?.id;

  // While the server reports `building` (no snapshot yet + a transient rebuild
  // failure), poll fast so the real data lands within a couple seconds instead
  // of on the 20s cadence. Mirrored into state (can't read the query's own data
  // inside its options — temporal dead zone) and reset once it resolves.
  const [fastPoll, setFastPoll] = useState(false);

  const query = useSWRLike<UserExposure | null>(
    userId ? `exposure:${userId}` : null,
    ({ signal }) => fetchJson<UserExposure>(`/api/exposure/${userId}`, { signal }),
    {
      enabled: !!userId,
      fallbackData: null,
      persist: true,
      // Live-feel: the server recomputes exposure from completed drafts on each
      // GET (2s throttle), so refetch when the user returns to the tab and poll
      // every 20s while open. Finishing a draft → the data is fresh here without
      // a manual reload (Boris 2026-06-13).
      revalidateOnFocus: true,
      refreshInterval: fastPoll ? 3_000 : 20_000,
    },
  );

  useEffect(() => {
    setFastPoll(query.data?.building === true);
  }, [query.data]);

  return query;
}
