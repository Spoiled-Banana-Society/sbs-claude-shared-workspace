'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { NotificationCounts, NotificationCountsResponse } from '@/app/api/admin/notification-counts/route';

// Categories that surface as badges. `support` and `withdrawals` are
// state-driven (Crisp unread / Firestore status==pending) — they
// auto-clear when the underlying state changes, not on tab visit.
export type NotifCategory =
  | 'support'
  | 'errors'
  | 'kyc'
  | 'offramp'
  | 'onramp'
  | 'withdrawals'
  | 'purchases'
  | 'drafts';

// Subset of categories that auto-clear when the admin opens the tab.
// The hook stores `lastSeenAt[cat]` in localStorage and passes those
// values to the API so each category's count only includes items
// newer than `lastSeenAt[cat]`.
const VISIT_CLEARED: NotifCategory[] = ['errors', 'kyc', 'offramp', 'onramp', 'purchases', 'drafts'];

const STORAGE_KEY = 'admin.notifications.lastSeen.v1';
const POLL_MS = 30_000;

interface LastSeenMap {
  errors?: number;
  kyc?: number;
  offramp?: number;
  onramp?: number;
  purchases?: number;
  drafts?: number;
}

function readLastSeen(): LastSeenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch { return {}; }
}

function writeLastSeen(map: LastSeenMap): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
}

interface UseAdminAuthHeadersFn {
  (): () => Promise<HeadersInit>;
}

interface Options {
  enabled: boolean;
  /**
   * Re-uses the existing admin auth headers helper from useAdminApi so
   * the bearer token flow stays consistent. Passed in to avoid a
   * circular import.
   */
  useAuthHeaders: UseAdminAuthHeadersFn;
}

interface UseAdminNotificationsResult {
  counts: NotificationCounts;
  total: number;
  /**
   * Mark a tab as seen. Resets `lastSeenAt[cat] = now()` so the next
   * poll returns 0 for that category (until new items appear).
   * State-driven categories (support, withdrawals) ignore this.
   */
  markSeen: (cat: NotifCategory) => void;
}

export function useAdminNotifications({ enabled, useAuthHeaders }: Options): UseAdminNotificationsResult {
  const getHeaders = useAuthHeaders();
  const [lastSeen, setLastSeen] = useState<LastSeenMap>(() => readLastSeen());

  const sinceParam = useMemo(() => JSON.stringify(lastSeen), [lastSeen]);

  const query = useQuery<NotificationCountsResponse>({
    queryKey: ['admin', 'notification-counts', sinceParam],
    enabled,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const headers = await getHeaders();
      const url = `/api/admin/notification-counts?since=${encodeURIComponent(sinceParam)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`notification-counts ${res.status}`);
      return res.json();
    },
  });

  const counts: NotificationCounts = query.data?.counts ?? {
    support: 0, errors: 0, kyc: 0, offramp: 0, onramp: 0,
    withdrawals: 0, purchases: 0, drafts: 0,
  };

  // `purchases` (failed mints) is tracked by the endpoint but has no
  // dedicated tab yet — exclude from the badge total so it can't sit
  // there forever with nowhere to clear. Add it back when a UI lands.
  const total = counts.support + counts.errors + counts.kyc + counts.offramp
    + counts.onramp + counts.withdrawals + counts.drafts;

  const markSeen = useCallback((cat: NotifCategory) => {
    if (!VISIT_CLEARED.includes(cat)) return;
    setLastSeen((prev) => {
      const next: LastSeenMap = { ...prev, [cat]: Date.now() };
      writeLastSeen(next);
      return next;
    });
  }, []);

  // Sync across tabs — if another admin tab marks a category seen,
  // re-read from localStorage so this tab's badges drop too.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLastSeen(readLastSeen());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { counts, total, markSeen };
}
