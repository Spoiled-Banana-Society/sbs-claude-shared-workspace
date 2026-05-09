// Coinbase / MoonPay onramp (buy) audit log.
// Mirrors lib/offrampAudit.ts. Logs every onramp attempt — when we
// issue a Coinbase session token, when a Coinbase tx fails (with the
// specific status_reason from CDP), and when a purchase ultimately
// settles into USDC + minted draft passes.
//
// What gets tracked per provider:
//
//   Coinbase:
//     - session_created    → buy-session token issued
//     - tx_failed          → Coinbase reports failure (LIMIT_EXCEEDED,
//                             PAYMENT_DECLINED, etc.)
//     - tx_completed       → USDC landed + draft pass minted
//     - abandoned          → session_created with no resolution after
//                             ABANDONED_THRESHOLD_MS (1h)
//
//   MoonPay:
//     - tx_completed       → only — Privy owns the popup so we can't
//                             observe session/failure events without a
//                             client-side beacon. Good enough for the
//                             "did the purchase land?" admin view.

import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';

const ONRAMP_COLLECTION = 'onramp_attempts';
export const ABANDONED_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export type OnrampAttemptStatus =
  | 'session_created'      // buy-session token issued
  | 'tx_pending'           // tx exists, mid-flight
  | 'tx_completed'         // USDC landed + (typically) mint complete
  | 'tx_failed'            // Coinbase reported failure
  | 'abandoned';           // session_created with no progress in 1h

export type OnrampProvider = 'coinbase' | 'moonpay';

export interface OnrampAttempt {
  userId: string;          // canonical lowercase wallet-address key
  walletAddress?: string;
  provider: OnrampProvider;
  partnerUserId?: string;  // Coinbase partnerUserId we passed
  timestamp: string;       // ISO, when session_created
  updatedAt: string;
  status: OnrampAttemptStatus;
  amount?: number;         // USDC requested
  paymentMethod?: string;  // CARD / APPLE_PAY / ACH (Coinbase) | unknown for MoonPay
  // Coinbase-specific fields
  coinbaseTxId?: string;
  coinbaseTxStatus?: string;
  // failureReason carries the raw Coinbase enum (LIMIT_EXCEEDED etc).
  // failureMessage is the friendly text we surfaced to the user.
  failureReason?: string;
  failureMessage?: string;
  // For LIMIT_EXCEEDED — when their weekly cap resets.
  nextAvailableAt?: string;
  txDetectedAt?: string;
  txCompletedAt?: string;
  // tx hash on Base, when the actual mint happens
  mintTxHash?: string;
  // Number of draft passes purchased
  passQuantity?: number;
  // For arbitrary diagnostic data
  errorMessage?: string;
}

/**
 * Log a freshly-created Coinbase Onramp session. Returns the Firestore
 * doc id so callers can reference it later if they want to update by
 * id (most flows use lookup-by-most-recent-open, which is easier).
 */
export async function logOnrampSessionCreated(input: {
  userId: string;
  walletAddress?: string;
  provider: OnrampProvider;
  partnerUserId?: string;
  amount?: number;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const now = new Date().toISOString();
    const db = getAdminFirestore();
    const doc: Partial<OnrampAttempt> = {
      userId: input.userId,
      provider: input.provider,
      timestamp: now,
      updatedAt: now,
      status: 'session_created',
    };
    if (input.walletAddress) doc.walletAddress = input.walletAddress;
    if (input.partnerUserId) doc.partnerUserId = input.partnerUserId;
    if (typeof input.amount === 'number') doc.amount = input.amount;
    const ref = await db.collection(ONRAMP_COLLECTION).add(doc);
    return ref.id;
  } catch (err) {
    console.error('[Onramp Audit] logOnrampSessionCreated failed:', err);
    return null;
  }
}

/**
 * Update the user's most recent open Coinbase attempt with a failure
 * captured from the buy-status API. Idempotent — re-failing the same
 * attempt just updates the timestamp.
 */
export async function logOnrampFailure(input: {
  userId: string;
  failureReason: string;     // raw Coinbase enum — LIMIT_EXCEEDED etc.
  failureMessage: string;    // friendly copy we showed user
  nextAvailableAt?: string;  // for LIMIT_EXCEEDED only
  coinbaseTxId?: string;
  coinbaseTxStatus?: string;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const snap = await db
      .collection(ONRAMP_COLLECTION)
      .where('userId', '==', input.userId)
      .where('provider', '==', 'coinbase')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();
    const target = snap.docs.find((d) => {
      const data = d.data() as OnrampAttempt;
      return data.status === 'session_created' || data.status === 'tx_pending';
    });
    const now = new Date().toISOString();
    const update: Partial<OnrampAttempt> = {
      status: 'tx_failed',
      updatedAt: now,
      failureReason: input.failureReason,
      failureMessage: input.failureMessage,
    };
    if (input.nextAvailableAt) update.nextAvailableAt = input.nextAvailableAt;
    if (input.coinbaseTxId) update.coinbaseTxId = input.coinbaseTxId;
    if (input.coinbaseTxStatus) update.coinbaseTxStatus = input.coinbaseTxStatus;

    if (target) {
      await target.ref.set(update, { merge: true });
      return target.id;
    }
    // No open attempt found — create a fresh failure record so admin
    // still sees it. Happens when buy-status is queried without a
    // matching session record (e.g. session created via a different
    // partner, or admin tooling).
    const newDoc: Partial<OnrampAttempt> = {
      userId: input.userId,
      provider: 'coinbase',
      timestamp: now,
      ...update,
    };
    const ref = await db.collection(ONRAMP_COLLECTION).add(newDoc);
    return ref.id;
  } catch (err) {
    console.error('[Onramp Audit] logOnrampFailure failed:', err);
    return null;
  }
}

/**
 * Log a successful purchase. Called from /api/purchases/card-mint when
 * the mint settles on-chain.
 *
 * For Coinbase: updates the user's open session to tx_completed.
 * For MoonPay: creates a new tx_completed record (we never logged a
 *   session_created for MoonPay because Privy owns its popup).
 */
export async function logOnrampCompleted(input: {
  userId: string;
  walletAddress?: string;
  provider: OnrampProvider;
  amount: number;
  passQuantity: number;
  mintTxHash?: string;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const now = new Date().toISOString();

    if (input.provider === 'coinbase') {
      // Update the user's most recent open session.
      const snap = await db
        .collection(ONRAMP_COLLECTION)
        .where('userId', '==', input.userId)
        .where('provider', '==', 'coinbase')
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();
      const target = snap.docs.find((d) => {
        const data = d.data() as OnrampAttempt;
        return data.status === 'session_created' || data.status === 'tx_pending';
      });
      if (target) {
        const update: Partial<OnrampAttempt> = {
          status: 'tx_completed',
          updatedAt: now,
          txCompletedAt: now,
          passQuantity: input.passQuantity,
        };
        if (input.mintTxHash) update.mintTxHash = input.mintTxHash;
        if (input.walletAddress) update.walletAddress = input.walletAddress;
        await target.ref.set(update, { merge: true });
        return target.id;
      }
    }

    // MoonPay path OR Coinbase with no open session — create a new
    // tx_completed record from scratch.
    const newDoc: Partial<OnrampAttempt> = {
      userId: input.userId,
      provider: input.provider,
      timestamp: now,
      updatedAt: now,
      status: 'tx_completed',
      txCompletedAt: now,
      amount: input.amount,
      passQuantity: input.passQuantity,
    };
    if (input.walletAddress) newDoc.walletAddress = input.walletAddress;
    if (input.mintTxHash) newDoc.mintTxHash = input.mintTxHash;
    const ref = await db.collection(ONRAMP_COLLECTION).add(newDoc);
    return ref.id;
  } catch (err) {
    console.error('[Onramp Audit] logOnrampCompleted failed:', err);
    return null;
  }
}

/**
 * List recent onramp attempts. Lazy-marks stale session_created docs
 * as abandoned so admin doesn't have to run a cron.
 */
export async function listOnrampAttempts(opts: {
  limit?: number;
  status?: OnrampAttemptStatus;
  provider?: OnrampProvider;
  userId?: string;
}): Promise<Array<OnrampAttempt & { id: string }>> {
  if (!isFirestoreConfigured()) return [];
  try {
    const db = getAdminFirestore();
    let q = db.collection(ONRAMP_COLLECTION).orderBy('timestamp', 'desc');
    if (opts.status) q = q.where('status', '==', opts.status);
    if (opts.provider) q = q.where('provider', '==', opts.provider);
    if (opts.userId) q = q.where('userId', '==', opts.userId);
    const snap = await q.limit(opts.limit ?? 50).get();

    const now = Date.now();
    const result: Array<OnrampAttempt & { id: string }> = [];
    const abandonUpdates: Array<Promise<unknown>> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as OnrampAttempt;
      if (
        data.status === 'session_created' &&
        Date.parse(data.timestamp) < now - ABANDONED_THRESHOLD_MS
      ) {
        const updated: OnrampAttempt = {
          ...data,
          status: 'abandoned',
          updatedAt: new Date().toISOString(),
        };
        abandonUpdates.push(doc.ref.set(updated, { merge: true }));
        result.push({ id: doc.id, ...updated });
      } else {
        result.push({ id: doc.id, ...data });
      }
    }
    Promise.all(abandonUpdates).catch(() => { /* fire-and-forget */ });
    return result;
  } catch (err) {
    console.error('[Onramp Audit] listOnrampAttempts failed:', err);
    return [];
  }
}
