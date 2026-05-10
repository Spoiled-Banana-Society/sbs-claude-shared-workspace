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
import { getUserOnrampTransactions, type OnrampTransaction } from './cdpAuth';

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

    // Try to update the user's most recent open session for this provider.
    // Works for both Coinbase (server-logged in buy-session) and MoonPay
    // (client-logged via /api/onramp/log-session before fundWallet).
    const snap = await db
      .collection(ONRAMP_COLLECTION)
      .where('userId', '==', input.userId)
      .where('provider', '==', input.provider)
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

    // No open session found — create a new tx_completed record from
    // scratch. Happens when the session_created beacon was missed
    // (offline / blocked) or for Coinbase if buy-session never fired.
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

// Map raw Coinbase status enums to user-facing copy. Mirrors the
// classifier in /api/coinbase/buy-status — kept in sync so admin
// sees the same explanation the user got. Worth dedoping eventually
// but not blocking ship.
function classifyCoinbaseFailure(statusReason: string | undefined): { friendly: string; code: string } {
  const code = (statusReason || '').toUpperCase();
  switch (code) {
    case 'LIMIT_EXCEEDED':
    case 'BUY_LIMIT_EXCEEDED':
    case 'WEEKLY_LIMIT_EXCEEDED':
      return { friendly: "Hit Coinbase's $500 weekly purchase limit.", code: 'LIMIT_EXCEEDED' };
    case 'PAYMENT_DECLINED':
    case 'CARD_DECLINED':
      return { friendly: 'Card was declined by Coinbase.', code: 'PAYMENT_DECLINED' };
    case 'CANCELED':
    case 'CANCELLED':
    case 'USER_CANCELED':
      return { friendly: 'Cancelled the Coinbase popup before paying.', code: 'CANCELED' };
    case 'KYC_REQUIRED':
    case 'IDENTITY_VERIFICATION_REQUIRED':
      return { friendly: 'Coinbase required additional identity verification.', code: 'KYC_REQUIRED' };
    case 'GEO_RESTRICTED':
    case 'REGION_NOT_SUPPORTED':
      return { friendly: "Coinbase isn't available in user's region.", code: 'GEO_RESTRICTED' };
    default:
      return { friendly: `Coinbase reported failure: ${code || 'UNKNOWN'}`, code: code || 'UNKNOWN' };
  }
}

/**
 * Pull Coinbase's actual transaction state for a partnerUserId and
 * update the matching attempt doc. This is the "reconcile" path —
 * runs lazily when admin views the dashboard so session_created rows
 * with no follow-up get filled in with whatever Coinbase says
 * happened, even if the user closed the browser before our frontend
 * could report back.
 *
 * Best-effort: errors are swallowed (admin still sees the un-updated
 * row). Limited to 20 reconciliations per call to keep latency sane.
 */
async function reconcileSessionCreatedAttempts(
  attempts: Array<OnrampAttempt & { id: string }>,
  maxReconciliations = 20,
): Promise<Array<OnrampAttempt & { id: string }>> {
  if (!isFirestoreConfigured()) return attempts;

  // Only Coinbase entries can be reconciled — MoonPay tx state is
  // owned by Privy, no API access from us.
  const candidates = attempts
    .filter((a) =>
      a.provider === 'coinbase' &&
      a.status === 'session_created' &&
      !!a.partnerUserId,
    )
    .slice(0, maxReconciliations);

  if (candidates.length === 0) return attempts;

  // Group by partnerUserId so we make one Coinbase call per user even
  // if they have multiple session_created rows.
  const byPartner = new Map<string, Array<OnrampAttempt & { id: string }>>();
  for (const a of candidates) {
    const key = a.partnerUserId!;
    if (!byPartner.has(key)) byPartner.set(key, []);
    byPartner.get(key)!.push(a);
  }

  const db = getAdminFirestore();
  const updates: Array<Promise<unknown>> = [];
  const updatedById = new Map<string, OnrampAttempt & { id: string }>();

  await Promise.all(Array.from(byPartner.entries()).map(async ([partnerUserId, group]) => {
    let txs: OnrampTransaction[] = [];
    try {
      const res = await getUserOnrampTransactions(partnerUserId, 10);
      txs = res.transactions;
    } catch (err) {
      console.warn('[Onramp Audit] reconcile fetch failed for', partnerUserId, (err as Error).message);
      return;
    }

    // For each session_created attempt, find a Coinbase tx that was
    // created at or after our session timestamp. Coinbase's response
    // is most-recent-first; we take the closest match.
    for (const attempt of group) {
      const sessionMs = Date.parse(attempt.timestamp);
      const candidate = txs.find((t) => {
        const ts = Date.parse(t.created_at);
        // Allow a small grace before the session timestamp (clock skew).
        return Number.isFinite(ts) && ts >= sessionMs - 60_000;
      });
      if (!candidate) continue;

      const status = (candidate.status || '').toUpperCase();
      const now = new Date().toISOString();
      const update: Partial<OnrampAttempt> = {
        coinbaseTxId: candidate.id,
        coinbaseTxStatus: candidate.status,
        updatedAt: now,
      };

      if (status.includes('SUCCESS') || status.includes('COMPLETE')) {
        update.status = 'tx_completed';
        update.txCompletedAt = now;
      } else if (status.includes('FAIL') || status.includes('CANCEL') || status.includes('DECLIN')) {
        const { friendly, code } = classifyCoinbaseFailure(candidate.status_reason);
        update.status = 'tx_failed';
        update.failureReason = code;
        update.failureMessage = friendly;
      } else {
        // PENDING / IN_PROGRESS — promote session_created → tx_pending
        // so admin sees something is happening.
        update.status = 'tx_pending';
        update.txDetectedAt = now;
      }

      updates.push(
        db.collection(ONRAMP_COLLECTION).doc(attempt.id).set(update, { merge: true }),
      );
      updatedById.set(attempt.id, { ...attempt, ...update } as OnrampAttempt & { id: string });
    }
  }));

  // Don't block on writes — fire-and-forget. Return the merged in-memory
  // version so the admin sees fresh data on this load.
  Promise.all(updates).catch(() => { /* best-effort */ });

  return attempts.map((a) => updatedById.get(a.id) ?? a);
}

/**
 * List recent onramp attempts. Lazy-marks stale session_created docs
 * as abandoned so admin doesn't have to run a cron, and reconciles
 * Coinbase session_created rows against Coinbase's actual transaction
 * state so admin sees real outcomes even when the user closed the
 * browser before our frontend reported back.
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

    // Reconcile session_created Coinbase entries against the real
    // Coinbase transaction state. Lets admin see actual outcomes
    // (failed / completed / pending) even when the user never came
    // back to our modal. Best-effort.
    return await reconcileSessionCreatedAttempts(result);
  } catch (err) {
    console.error('[Onramp Audit] listOnrampAttempts failed:', err);
    return [];
  }
}
