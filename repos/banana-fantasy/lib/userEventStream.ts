/**
 * Real-time user event stream — server-side push for instant toast +
 * notification delivery.
 *
 * Separate from `lib/userEvents.ts` (Firestore audit log) — this one writes
 * lightweight pings to Firebase RTDB at:
 *   `userEvents/{userId}/{auto-push-id}`
 *
 * Frontend subscribes via `subscribeUserEvents` (lib/api/firebase.ts) and
 * fires a toast + bell entry within ~100ms. Sensitive details (friend
 * identity, balances, claim history) stay in Firestore behind the existing
 * Privy-authed API — the RTDB payload only carries a type + lightweight
 * metadata sufficient to render the toast and trigger a fresh authed
 * detail fetch when needed.
 *
 * Why public RTDB is OK for these payloads:
 *  - Badge unlocks: already visible on public profile pages.
 *  - Promo events ("you got a free spin"): same info renders in admin
 *    activity feeds + leaderboards. No PII / balances / addresses.
 *  - Referral milestones: NO friend identity in the payload. The toast
 *    string ("Your friend Sarah verified!") is rendered after the
 *    frontend refetches /api/promos which is Privy-authed.
 *
 * Idempotency: each call uses `push()` to generate an auto-ID, so a
 * duplicate call produces a separate event. Frontend dedups via the
 * per-user `sbs-stream-seen:<userId>` localStorage set (mirrors
 * useBadgeUnlockNotifier's `sbs-badges-notified` pattern).
 *
 * Feature flag: set env `USER_EVENTS_PUSH_DISABLED=1` to kill the writes
 * without redeploying frontend. RTDB silently receiving no events is a
 * benign degradation — the existing badge poll + promo page-load fetch
 * remain as fallbacks.
 */

import { waitUntil } from '@vercel/functions';
import { getAdminDatabase, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export type StreamEventType =
  | 'badge-unlock'
  | 'promo-pick-10'
  | 'promo-jackpot-hit'
  | 'promo-buy-10'
  | 'promo-daily-drafts'
  | 'promo-new-user'
  | 'promo-first-purchase'
  | 'first-purchase-unlocked'
  | 'referral-milestone'
  | 'promo-card-free-draft'
  | 'promo-buy-bonus'
  | 'spin-won'
  // Content-less "a new persisted notification exists — refetch the bell"
  // ping. Fired by createNotification (lib/queueNotifications.ts) so the
  // server-backed notification inbox updates in ~100ms across every device.
  | 'notification';

export interface StreamEventPayload {
  /** Draft id (Pick 10, Jackpot Hit). */
  draftId?: string;
  /** Badge id (badge-unlock only). */
  badgeId?: string;
  /** Referral milestone name. */
  milestone?: 'verified' | 'bought1' | 'bought10';
  /** Diagnostic label for where the event was fired from. */
  source?: string;
  /** Bulk award count (Buy 10 fires once per buy regardless of multiplier). */
  awardedCount?: number;
  /** Wheel spin id (spin-won only) — drives the bell entry's dedupeKey. */
  spinId?: string;
  /** Human prize label for spin-won (e.g. "2 Draft Passes"). */
  prizeLabel?: string;
  /**
   * For the `'notification'` ping: the bell entry's content, so receiving
   * devices render it INSTANTLY without a refetch round-trip. Non-sensitive
   * (generic copy — no balances/PII), same bar as the rest of this payload.
   */
  notifId?: string;
  notifType?: string;
  notifTitle?: string;
  notifMessage?: string;
  notifLink?: string;
  notifIcon?: string;
}

/**
 * Push a real-time event to the user's RTDB stream. Best-effort, never throws.
 *
 * Callers must NOT block their write path on this — RTDB failure is logged
 * and swallowed so the actual user action (unlocking a badge, flipping a
 * promo) is never blocked by an event push problem.
 */
export async function pushStreamEvent(
  userId: string,
  type: StreamEventType,
  payload: StreamEventPayload = {},
): Promise<void> {
  if (process.env.USER_EVENTS_PUSH_DISABLED === '1') {
    logger.info('stream.push.disabled-by-flag', { userId, type });
    return;
  }
  if (!userId) {
    logger.warn('stream.push.missing-userId', { type });
    return;
  }
  if (!isFirestoreConfigured()) {
    // Same gate the rest of the backend uses; silently no-op when admin
    // SDK isn't configured (e.g. local dev without service account).
    return;
  }

  try {
    const rtdb = getAdminDatabase();
    const ref = rtdb.ref(`userEvents/${userId.toLowerCase()}`);
    const event = {
      type,
      timestamp: Date.now(),
      ...payload,
    };
    await ref.push(event);
    logger.info('stream.push.ok', { userId, type });

    // Persist a server-backed bell notification for content-bearing events
    // so the notification inbox is account-synced across every device. The
    // content-less `'notification'` type is the refetch ping itself — skip it
    // to avoid recursion. Dynamic imports break the circular dep
    // (queueNotifications imports pushStreamEvent). Best-effort.
    if (type !== 'notification') {
      try {
        const { eventNotificationContent } = await import('./eventNotifications');
        const content = eventNotificationContent(userId.toLowerCase(), type, payload);
        if (content) {
          const { createNotification } = await import('./queueNotifications');
          await createNotification(userId, content);
        }
      } catch (persistErr) {
        logger.warn('stream.persist.failed', {
          userId,
          type,
          err: persistErr instanceof Error ? persistErr.message : String(persistErr),
        });
      }
    }
  } catch (err) {
    logger.warn('stream.push.failed', {
      userId,
      type,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire-and-forget pushStreamEvent that SURVIVES the response. A bare
 * `void pushStreamEvent(...)` detaches the promise — on Vercel the lambda
 * freezes the moment the response is sent, so the RTDB ping (and the
 * persisted bell notification it dual-writes) lands late or never. That was
 * the "toast didn't show / noti took 5s" bug: the instant ping died with the
 * lambda and devices only caught up on the next bell poll. `waitUntil` keeps
 * the function alive until the push completes without delaying the response.
 */
export function pushStreamEventBg(
  userId: string,
  type: StreamEventType,
  payload: StreamEventPayload = {},
): void {
  const p = pushStreamEvent(userId, type, payload);
  try {
    waitUntil(p);
  } catch {
    // No Vercel request context (local dev / scripts) — promise runs detached.
  }
}
