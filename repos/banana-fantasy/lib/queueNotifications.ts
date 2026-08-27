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
import { getSlowClockCopy } from '@/lib/slowClockServer';
import { FieldValue } from 'firebase-admin/firestore';
import { pushStreamEventBg } from '@/lib/userEventStream';

const COLLECTION = 'marketplace_notifications';

import type { NotificationType } from '@/components/NotificationCenter';

export interface CreateNotificationInput {
  /** MUST be a type the client knows how to render — typed against the
   *  client's NotificationType union so adding a server-side type without
   *  teaching the client maps fails the BUILD instead of crashing the bell
   *  in production (2026-06-10: unmapped 'prize'/'welcome' types crashed
   *  the panel + /notifications for any holder — looked like logouts). */
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  /** Content-stable key for cross-device idempotency. Omit for always-distinct events. */
  dedupeKey?: string;
  /** Emoji/glyph shown as this notification's icon in the bell + /notifications.
   *  Lets each event carry a meaningful icon (e.g. a badge's own glyph) instead
   *  of every promo-type notification falling back to the same generic emoji. */
  icon?: string;
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
      icon: n.icon ?? null,
      createdAt: FieldValue.serverTimestamp(),
    };

    let docId: string;
    if (n.dedupeKey) {
      docId = dedupeDocId(wallet, n.dedupeKey);
      try {
        await col.doc(docId).create(doc);
      } catch (e) {
        // ALREADY_EXISTS (gRPC code 6) → idempotent no-op; do NOT re-ping.
        const code = (e as { code?: number }).code;
        if (code === 6 || /already exists/i.test(String(e))) return;
        throw e;
      }
    } else {
      const ref = await col.add(doc);
      docId = ref.id;
    }

    // Real-time ping that CARRIES the notification content, so every device
    // renders it instantly (no GET round-trip). The client still refetches to
    // reconcile read-state/ordering. Best-effort, waitUntil-backed so the
    // ping outlives the response instead of dying with the frozen lambda.
    pushStreamEventBg(wallet, 'notification', {
      source: 'createNotification',
      notifId: docId,
      notifType: n.type,
      notifTitle: n.title,
      notifMessage: n.message,
      notifLink: n.link || '',
      notifIcon: n.icon || '',
    });
  } catch (err) {
    console.error('[createNotification] failed:', err);
  }
}

/**
 * Broadcast ONE notification to MANY wallets efficiently.
 *
 * For one-shot announcements (e.g. a promo turning on) a per-user
 * `createNotification` fan-out would be thousands of round-trips — each its
 * own write PLUS its own real-time RTDB ping. Instead this writes every bell
 * doc with a single BulkWriter (auto-batched, ~500 ops/commit) and skips the
 * per-user ping: online bells reconcile on their next poll and the companion
 * push (sent separately by the caller) carries the instant nudge.
 *
 * `dedupeKey` is REQUIRED — a broadcast is re-fired by every observer of the
 * same event (the 10 watching draft clients + the close backstop), so each
 * wallet's doc is written exactly once via `.create()` (ALREADY_EXISTS → no-op).
 * Returns the count of docs newly written.
 */
export async function createNotificationForWallets(
  wallets: string[],
  n: CreateNotificationInput & { dedupeKey: string },
): Promise<number> {
  if (!isFirestoreConfigured() || wallets.length === 0) return 0;
  const db = getAdminFirestore();
  const col = db.collection(COLLECTION);
  const writer = db.bulkWriter();
  // ALREADY_EXISTS (gRPC code 6) is the expected idempotent case — never retry
  // it. Retry genuinely transient failures a couple of times, then give up.
  writer.onWriteError((err) => err.code !== 6 && err.failedAttempts < 3);

  let written = 0;
  const seen = new Set<string>();
  for (const raw of wallets) {
    const wallet = String(raw).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet) || seen.has(wallet)) continue;
    seen.add(wallet);
    const docId = dedupeDocId(wallet, n.dedupeKey);
    void writer
      .create(col.doc(docId), {
        wallet,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link || null,
        read: false,
        dedupeKey: n.dedupeKey,
        icon: n.icon ?? null,
        createdAt: FieldValue.serverTimestamp(),
      })
      .then(() => { written += 1; })
      .catch(() => { /* ALREADY_EXISTS (deduped) or retries exhausted */ });
  }
  await writer.close();
  return written;
}

/** Notify user they've been queued */
export async function notifyQueueJoined(wallet: string, type: 'jackpot' | 'hof' | 'jackhof', draftCount: number) {
  const label = type === 'jackpot' ? 'Jackpot' : type === 'hof' ? 'HOF' : 'JackHOF';
  const clock = await getSlowClockCopy();
  await createNotification(wallet, {
    type: `${type}_queue`,
    title: `${label} Draft Queued!`,
    message: `You're in ${draftCount} ${label} draft queue${draftCount !== 1 ? 's' : ''} (${clock.hyphen} picks). The draft starts as soon as 10 winners fill the queue!`,
  });
}

/** Notify ALL members that a round is full — draft starting now */
export async function notifyQueueFilled(wallets: string[], type: 'jackpot' | 'hof' | 'jackhof') {
  const label = type === 'jackpot' ? 'Jackpot' : type === 'hof' ? 'HOF' : 'JackHOF';
  const clock = await getSlowClockCopy();
  const promises = wallets.map(wallet =>
    createNotification(wallet, {
      type: `${type}_queue`,
      title: `${label} Draft Starting!`,
      message: `10 winners are in! Your ${label} draft is starting now. ${clock.hyphen} picks — draft at your own pace.`,
      dedupeKey: `${type}-queue-filled-${wallet.toLowerCase()}`,
    })
  );
  await Promise.allSettled(promises);
}
