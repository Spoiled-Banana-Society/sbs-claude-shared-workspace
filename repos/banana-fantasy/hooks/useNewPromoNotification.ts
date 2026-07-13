'use client';

import { useEffect, useRef } from 'react';
import type { Promo } from '@/types';
import { pushNotification } from '@/components/NotificationCenter';
import { VISIBLE_PROMO_TYPES } from '@/lib/promoFilter';

/**
 * One-time "New Promo Available!" ping when a promo flagged `isNew: true`
 * (set on the promo definition in lib/api/seed.ts) shows up for this user.
 *
 * This is the ONLY promo reminder that survives the 2026-06-09 cleanup —
 * "Ready to Claim!" and "Last Chance!" nags were removed (real-time event
 * notis cover the moment something is actually earned). A new promo is a
 * genuine announcement, so it keeps its ping: once per promo per device,
 * marked permanently in localStorage (never re-fires on a cooldown).
 */
export function useNewPromoNotification(promos: Promo[]) {
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!promos || promos.length === 0 || checkedRef.current) return;
    checkedRef.current = true;

    for (const promo of promos) {
      // Only promos users can actually see in the carousel — seed.ts still
      // holds retired/hidden promos that must not announce themselves.
      if (!VISIBLE_PROMO_TYPES.has(promo.type)) continue;
      if (!promo.isNew) continue;

      const key = `sbs-promo-new-seen-${promo.id}`;
      try {
        if (localStorage.getItem(key)) continue;
      } catch { continue; }

      pushNotification({
        type: 'promo',
        title: 'New Promo Available!',
        message: promo.title,
        // Open the promo's modal so they see what it is before being asked
        // to act — straight to the ctaLink is action-without-context.
        link: `/promos?promo=${encodeURIComponent(promo.id)}`,
        dedupeKey: key,
      });
      try { localStorage.setItem(key, String(Date.now())); } catch { /* quota */ }
    }
  }, [promos]);
}
