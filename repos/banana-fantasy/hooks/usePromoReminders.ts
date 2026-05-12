'use client';

import { useEffect, useRef } from 'react';
import type { Promo } from '@/types';
import { pushNotification } from '@/components/NotificationCenter';

const REMINDER_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
// "Last Chance" reminder for the daily-drafts promo only. Fires when
// the user is ≥50% done AND the timer is about to expire within 3h.
// 50% means they engaged meaningfully (not a single accidental click);
// 3h is enough breathing room to actually finish without feeling
// panicky. Other progress promos (Buy 10, etc.) no longer trigger
// any partial-completion notification.
const LAST_CHANCE_PROGRESS_THRESHOLD = 0.5;
const LAST_CHANCE_TIME_REMAINING_MS = 3 * 60 * 60 * 1000; // 3 hours
const LAST_CHANCE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h — fits inside one close-to-deadline window

function wasRemindedRecently(key: string, windowMs = REMINDER_COOLDOWN_MS): boolean {
  try {
    const ts = localStorage.getItem(key);
    if (!ts) return false;
    return Date.now() - Number(ts) < windowMs;
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

    for (const promo of promos) {
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

      // Last-chance reminder for the daily drafts promo — only fires
      // when (a) the user is ≥50% of the way done, (b) the timer is
      // about to expire within 3h, and (c) the reward isn't already
      // claimable. Other progress promos no longer trigger any
      // partial-completion notification (low signal, mostly noise).
      if (promo.type === 'daily-drafts' && !promo.claimable && promo.timerEndTime) {
        const current = promo.progressCurrent ?? 0;
        const max = promo.progressMax ?? 0;
        const timeRemaining = new Date(promo.timerEndTime).getTime() - Date.now();
        if (
          max > 0
          && current > 0
          && current < max
          && current / max >= LAST_CHANCE_PROGRESS_THRESHOLD
          && timeRemaining > 0
          && timeRemaining <= LAST_CHANCE_TIME_REMAINING_MS
        ) {
          const key = `sbs-promo-lastchance-${promo.id}`;
          if (!wasRemindedRecently(key, LAST_CHANCE_COOLDOWN_MS)) {
            const drafts = max - current;
            pushNotification({
              type: 'promo',
              title: 'Last Chance!',
              message: `Draft ${drafts} more before the timer resets to claim your free spin.`,
              link: promo.ctaLink || '/drafting',
            });
            markReminded(key);
          }
        }
      }
    }
  }, [promos]);
}
