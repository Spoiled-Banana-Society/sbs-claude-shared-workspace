/**
 * Atomic, per-(user, draft, event) dedup — extracted from the original
 * pick-up route so both events share one implementation.
 *
 * A double-fired Cloud Function trigger must not produce two emails *and*
 * two Telegram messages, so the claim gates the whole dispatch, not a
 * single channel. Backed by Firestore `doc.create()`: only the first
 * concurrent caller lands the doc; others bounce on ALREADY_EXISTS.
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ClaimResult } from './types';

const SENT_COLLECTION = 'notificationsSent';

/**
 * Build the dedup doc id.
 * - your_turn: `{wallet}__{draftId}__{pickNumber}`
 * - filled:    `{wallet}__{draftId}__filled`
 */
export function dedupKey(
  walletAddress: string,
  draftId: string,
  pickNumber?: number | null,
): string {
  const wallet = walletAddress.trim().toLowerCase();
  const suffix =
    pickNumber != null && Number.isFinite(pickNumber) ? String(pickNumber) : 'filled';
  return `${wallet}__${draftId}__${suffix}`;
}

/**
 * Atomically claim the right to send for this key.
 * Throws on a real Firestore failure so the caller can return 502 rather
 * than silently dedup. With no Firestore configured, sends best-effort.
 */
export async function claimNotification(key: string): Promise<ClaimResult> {
  if (!isFirestoreConfigured()) return 'claimed';
  const ref = getAdminFirestore().collection(SENT_COLLECTION).doc(key);

  try {
    await ref.create({ status: 'pending', startedAt: FieldValue.serverTimestamp() });
    return 'claimed';
  } catch (err) {
    // Admin SDK reports ALREADY_EXISTS as numeric gRPC code 6 or the
    // string 'already-exists' depending on transport. Anything else is a
    // real failure and must not be swallowed.
    const code = (err as { code?: number | string } | undefined)?.code;
    if (code !== 6 && code !== 'already-exists') throw err;

    const snap = await ref.get();
    const status = snap.exists ? snap.get('status') : null;
    if (status === 'sent') return 'deduped';
    if (status === 'failed') {
      await ref.set(
        { status: 'pending', retriedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return 'retry';
    }
    // 'pending' (or unknown) — another worker is in flight; don't double-send.
    return 'deduped';
  }
}

/** Flip the claim to 'sent' after at least one channel succeeded. */
export async function markSent(key: string, recipients?: number): Promise<void> {
  if (!isFirestoreConfigured()) return;
  await getAdminFirestore()
    .collection(SENT_COLLECTION)
    .doc(key)
    .set(
      { status: 'sent', sentAt: FieldValue.serverTimestamp(), recipients: recipients ?? 0 },
      { merge: true },
    )
    .catch(() => {});
}

/** Flip the claim to 'failed' so the next trigger fire retries. */
export async function markFailed(key: string): Promise<void> {
  if (!isFirestoreConfigured()) return;
  await getAdminFirestore()
    .collection(SENT_COLLECTION)
    .doc(key)
    .set({ status: 'failed', failedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {});
}
