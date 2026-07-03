import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export type UserEventType =
  | 'signup'
  | 'login'
  | 'x_linked'
  | 'first_purchase'
  | 'wallet_linked'
  | 'promo_claimed';

export interface UserEventRecord {
  userId: string;
  eventType: UserEventType;
  meta?: Record<string, unknown>;
  timestamp: string; // ISO
}

const COLLECTION = 'v2_user_events';

export async function logUserEvent(
  userId: string,
  eventType: UserEventType,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!isFirestoreConfigured()) return;
  try {
    const db = getAdminFirestore();
    const doc: UserEventRecord = {
      userId: userId.toLowerCase(),
      eventType,
      ...(meta ? { meta } : {}),
      timestamp: new Date().toISOString(),
    };
    await db.collection(COLLECTION).add(doc);
    logger.debug('user.event.logged', { userId: doc.userId, eventType });
  } catch (err) {
    logger.error('user.event.write_failed', { err, userId, eventType });
  }
}

export async function fetchRecentUserEvents(limit = 100): Promise<UserEventRecord[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .orderBy('timestamp', 'desc')
    .limit(Math.min(limit, 500))
    .get();
  return snap.docs.map((d) => d.data() as UserEventRecord);
}

/**
 * Touch `v2_users/{wallet}.lastActiveAt` on authenticated activity.
 *
 * The previous implementation tried to count "logins" via an in-memory
 * 6h throttle. On Vercel that gets wiped on every cold start, so the
 * counts were unreliable. We dropped the whole session-count metric —
 * for SBS's scale (sub-1k users) what actually matters is "drafts /
 * spend / promos" per user, plus "are they ghosting or active right
 * now." This function powers the second part.
 *
 * Single read + (sometimes) a single write per request:
 *   - gap >= TOUCH_THROTTLE_MS → bump lastActiveAt
 *   - else                     → no-op (avoids hammering Firestore on
 *                                       chatty SSE polls)
 *
 * No `login` event written — the inflated noise from the old throttle
 * is left alone in v2_user_events for historical record; the dashboard
 * doesn't surface it anymore.
 */
const TOUCH_THROTTLE_MS = 5 * 60 * 1000;     // 5 minutes
// "Came back" definition for the admin Live Activity feed: first authenticated
// request after ≥6h of inactivity. At most a handful per day per user — a
// session signal, not a page-load signal (the old per-login events were
// dropped as noise for exactly that reason).
const RETURN_GAP_MS = 6 * 60 * 60 * 1000;
// A first-touch within this window of account creation is the signup itself —
// the user_signed_up event (fired at seed) covers it; don't double-ping.
const SIGNUP_GRACE_MS = 10 * 60 * 1000;
const SEASON_LAUNCH_MS = Date.parse('2026-06-23T00:00:00Z');
const USERS_COLLECTION = 'v2_users';

export async function recordActivityAndDetectLogin(
  userId: string,
  _meta?: Record<string, unknown>,
): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const lower = userId.toLowerCase();
  try {
    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(lower);
    const snap = await userRef.get();
    const data = snap.data() as {
      lastActiveAt?: string;
      createdAt?: string;
      isReturningPlayer?: boolean;
    } | undefined;
    const now = Date.now();
    const lastIso = data?.lastActiveAt;
    const last = lastIso ? Date.parse(lastIso) : 0;
    if (now - last >= TOUCH_THROTTLE_MS) {
      await userRef.set({ lastActiveAt: new Date(now).toISOString() }, { merge: true });

      // "Logged in / came back" event for the admin Live Activity feed.
      // Only for FULLY seeded users (snap.exists) — an auth touch can race
      // ahead of the seed and create a partial doc; that first contact is
      // the signup, which fires its own event from ensureUserSeeded.
      if (snap.exists && now - last >= RETURN_GAP_MS) {
        const createdMs = data?.createdAt ? Date.parse(data.createdAt) : NaN;
        const justSignedUp = Number.isFinite(createdMs) && now - createdMs < SIGNUP_GRACE_MS;
        if (!justSignedUp) {
          try {
            const [{ logActivityEvent }, { isReturningWalletSync }] = await Promise.all([
              import('@/lib/activityEvents'),
              import('@/lib/returningUsers'),
            ]);
            const isReturning = data?.isReturningPlayer === true || isReturningWalletSync(lower);
            void logActivityEvent({
              type: 'user_returned',
              userId: lower,
              metadata: {
                isReturning,
                isNewAccount: !isReturning && Number.isFinite(createdMs) && createdMs >= SEASON_LAUNCH_MS,
                firstSession: !lastIso,
                accountCreatedAt: data?.createdAt ?? null,
              },
            });
          } catch { /* presence event is cosmetic — never fail the touch */ }
        }
      }
    }
  } catch (err) {
    logger.error('user.activity.touch_failed', { err, userId: lower });
  }
}

/**
 * Back-compat shim. Used to write `login` events; now just touches
 * lastActiveAt via the same path. Old call sites keep working.
 */
export async function logLoginIfFresh(userId: string, meta?: Record<string, unknown>): Promise<void> {
  return recordActivityAndDetectLogin(userId, meta);
}
