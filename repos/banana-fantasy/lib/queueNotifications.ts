/**
 * Server-side notification hub.
 *
 * `createNotification` is the single entry point for writing a persisted,
 * per-wallet notification. It writes to the `marketplace_notifications`
 * Firestore collection (kept under that name to avoid migrating live data —
 * it is now the GENERAL notification store, not marketplace-only) and fires a
 * lightweight real-time `'notification'` ping over the user event stream so
 * every device's bell refetches within ~100ms.
 *
 * Cross-device idempotency: pass a content-stable `dedupeKey` (e.g.
 * `badge-veteran`, `promo-pick-10-<draftId>`). The doc id is derived from
 * (wallet, dedupeKey) and written with `.create()`, so the same logical
 * event fired from two devices — or retried — produces exactly one doc and
 * never resurrects an already-read notification as unread.
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { pushStreamEvent } from '@/lib/userEventStream';

const COLLECTION = 'marketplace_notifications';

export interface CreateNotificationInput {
  type: string;
  title: string;
  message: string;
  link?: string;
  /** Content-stable key for cross-device idempotency. Omit for always-distinct events. */
  dedupeKey?: string;
}

/** Firestore doc ids can't contain '/' and have a 1500-byte cap; make a safe stable id. */
function dedupeDocId(wallet: string, key: string): string {
  return `${wallet}__${key}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
}

/**
 * Create a persisted notification for a user (by wallet/userId) and ping
 * their devices to refetch. Best-effort — never throws into the caller's
 * write path.
 */
export async function createNotification(userId: string, n: CreateNotificationInput): Promise<void> {
  if (!isFirestoreConfigured() || !userId) return;
  const wallet = userId.toLowerCase();
  try {
    const db = getAdminFirestore();
    const col = db.collection(COLLECTION);
    const doc = {
      wallet,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link || null,
      read: false,
      dedupeKey: n.dedupeKey ?? null,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (n.dedupeKey) {
      try {
        await col.doc(dedupeDocId(wallet, n.dedupeKey)).create(doc);
      } catch (e) {
        // ALREADY_EXISTS (gRPC code 6) → idempotent no-op; do NOT re-ping.
        const code = (e as { code?: number }).code;
        if (code === 6 || /already exists/i.test(String(e))) return;
        throw e;
      }
    } else {
      await col.add(doc);
    }

    // Real-time refetch ping (best-effort, fire-and-forget).
    void pushStreamEvent(wallet, 'notification', { source: 'createNotification' });
  } catch (err) {
    console.error('[createNotification] failed:', err);
  }
}

/** Notify user they've been queued */
export async function notifyQueueJoined(wallet: string, type: 'jackpot' | 'hof', draftCount: number) {
  const label = type === 'jackpot' ? 'Jackpot' : 'HOF';
  const emoji = type === 'jackpot' ? '🔥' : '🏆';
  await createNotification(wallet, {
    type: `${type}_queue`,
    title: `${emoji} ${label} Draft Queued!`,
    message: `You're in ${draftCount} ${label} draft queue${draftCount !== 1 ? 's' : ''} (8-hour picks). The draft starts as soon as 10 winners fill the queue!`,
  });
}

/** Notify ALL members that a round is full — draft starting now */
export async function notifyQueueFilled(wallets: string[], type: 'jackpot' | 'hof') {
  const label = type === 'jackpot' ? 'Jackpot' : 'HOF';
  const emoji = type === 'jackpot' ? '🔥' : '🏆';
  const promises = wallets.map(wallet =>
    createNotification(wallet, {
      type: `${type}_queue`,
      title: `${emoji} ${label} Draft Starting!`,
      message: `10 winners are in! Your ${label} draft is starting now. 8-hour picks — draft at your own pace.`,
      dedupeKey: `${type}-queue-filled-${wallet.toLowerCase()}`,
    })
  );
  await Promise.allSettled(promises);
}
