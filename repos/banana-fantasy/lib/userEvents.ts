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
    const data = snap.data() as { lastActiveAt?: string } | undefined;
    const now = Date.now();
    const lastIso = data?.lastActiveAt;
    const last = lastIso ? Date.parse(lastIso) : 0;
    if (now - last >= TOUCH_THROTTLE_MS) {
      await userRef.set({ lastActiveAt: new Date(now).toISOString() }, { merge: true });
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
