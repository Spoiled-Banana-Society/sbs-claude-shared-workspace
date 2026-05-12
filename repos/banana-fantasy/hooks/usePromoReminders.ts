'use client';

import { useEffect, useRef } from 'react';
import type { Promo } from '@/types';
import { pushNotification } from '@/components/NotificationCenter';

const REMINDER_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
// Only nudge a partially-complete promo when the user is at least
// this fraction of the way done. Below this they're not actually
// "almost there" and the noti is just noise.
const ALMOST_THERE_THRESHOLD = 0.75;
// Cap "Almost There" pings to one per session even if multiple
// promos qualify — too many "do this now" pings in one shot feels
// spammy. New-promo and ready-to-claim notifications are still
// uncapped because they're individually actionable.
const MAX_ALMOST_THERE_PER_SESSION = 1;

function wasRemindedRecently(key: string): boolean {
  try {
    const ts = localStorage.getItem(key);
    if (!ts) return false;
    return Date.now() - Number(ts) < REMINDER_COOLDOWN_MS;
  } catch { return false; }
}

function markReminded(key: string) {
  try { localStorage.setItem(key, String(Date.now())); } catch {}
}

/**
 * Checks promos on load and pushes reminders for:
 * 1. New promos the user hasn't seen
 * 2. Partially complete promos (progress > 0 but not done)
 * 3. Promos ready to claim
 *
 * Each reminder has a 24h cooldown to prevent spam.
 */
export function usePromoReminders(promos: Promo[]) {
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!promos || promos.length === 0 || checkedRef.current) return;
    checkedRef.current = true;

    // Sort partially-complete promos by closest-to-done so the one
    // we surface (under the per-session cap) is the most likely to
    // actually be finished.
    const sorted = [...promos].sort((a, b) => {
      const aPct = (a.progressMax ?? 0) > 0 ? (a.progressCurrent ?? 0) / a.progressMax! : 0;
      const bPct = (b.progressMax ?? 0) > 0 ? (b.progressCurrent ?? 0) / b.progressMax! : 0;
      return bPct - aPct;
    });

    let almostThereCount = 0;
    for (const promo of sorted) {
      // New promo the user hasn't seen
      if (promo.isNew) {
        const key = `sbs-promo-new-seen-${promo.id}`;
        if (!wasRemindedRecently(key)) {
          pushNotification({
            type: 'promo',
            title: 'New Promo Available!',
            message: promo.title,
            link: promo.ctaLink || '/promos',
          });
          markReminded(key);
        }
        continue;
      }

      // Ready to claim
      if (promo.claimable && (promo.claimCount ?? 0) > 0) {
        const key = `sbs-promo-claim-${promo.id}`;
        if (!wasRemindedRecently(key)) {
          pushNotification({
            type: 'promo',
            title: 'Ready to Claim!',
            message: `${promo.title} — your reward is waiting.`,
            link: promo.ctaLink || '/promos',
          });
          markReminded(key);
        }
        continue;
      }

      // Partially complete — nudge to finish, but only when the user
      // is genuinely close (≥75% done) and we haven't already pinged
      // for another promo this session. Message intentionally omits
      // the live count so a stale notification doesn't lie when the
      // user's progress changes after the noti was queued.
      const current = promo.progressCurrent ?? 0;
      const max = promo.progressMax ?? 0;
      if (
        current > 0
        && max > 0
        && current < max
        && !promo.claimable
        && current / max >= ALMOST_THERE_THRESHOLD
        && almostThereCount < MAX_ALMOST_THERE_PER_SESSION
      ) {
        const key = `sbs-promo-reminded-${promo.id}`;
        if (!wasRemindedRecently(key)) {
          pushNotification({
            type: 'promo',
            title: 'Almost There!',
            message: `Finish ${promo.title} to claim your reward.`,
            link: promo.ctaLink || '/promos',
          });
          markReminded(key);
          almostThereCount += 1;
        }
      }
    }
  }, [promos]);
}
