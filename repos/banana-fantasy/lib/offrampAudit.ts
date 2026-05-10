// Coinbase offramp (cashout) audit log.
// Mirrors lib/kycAudit.ts. Logs every cashout attempt — when we issue a
// Coinbase session token, when the user returns with a tx, and the tx's
// final outcome — so the admin can see who got stuck where.
//
// Limitations: we can't see INSIDE Coinbase's popup. We only know:
//   - they started (session_created)
//   - whether a tx was created (tx_seen via tx-status)
//   - the tx's eventual status (pending → completed | failed)
// "Abandoned" is derived: session_created with no tx_seen update after
// the threshold below.

import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';
import { logActivityEvent } from './activityEvents';
import { getUserOfframpTransactions, type OfframpTransaction } from './cdpAuth';

const OFFRAMP_COLLECTION = 'offramp_attempts';
export const ABANDONED_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export type OfframpAttemptStatus =
  | 'session_created'      // We issued a Coinbase session token, popup launched
  | 'tx_pending'           // Coinbase has a tx for this user, not yet settled
  | 'tx_completed'         // Coinbase reports tx fully completed
  | 'tx_failed'            // Coinbase reports tx failed
  | 'abandoned';           // session_created but no tx after ABANDONED_THRESHOLD_MS

// Distinguishes how the user is offramping. Different code paths log different
// values, so admin can filter by source.
//   - 'coinbase_offramp': through Coinbase's hosted offramp (USDC → USD/bank)
//   - 'direct_usdc':       direct USDC transfer to user's external wallet
//   - 'direct_bank':       (future) direct ACH bypassing Coinbase
export type OfframpSource = 'coinbase_offramp' | 'direct_usdc' | 'direct_bank';

export interface OfframpAttempt {
  userId: string;          // canonical wallet-address-lowercase key
  walletAddress?: string;
  source: OfframpSource;
  partnerUserId?: string;  // what we passed to Coinbase as partnerUserId
  timestamp: string;       // ISO — when session_created
  updatedAt: string;       // ISO — last status change
  status: OfframpAttemptStatus;
  amount?: number;         // USDC requested in our UI (what user typed)
  paymentMethod?: string;  // ACH_BANK_ACCOUNT / FIAT_WALLET / CRYPTO_ACCOUNT (Coinbase) | usdc / bank (direct)
  draftId?: string;        // tied prize, if any
  // Updated when tx-status polling sees a real Coinbase tx
  coinbaseTxId?: string;
  coinbaseTxStatus?: string; // raw status string from Coinbase
  txDetectedAt?: string;
  txCompletedAt?: string;
  // Settled values from Coinbase's tx object — the source of truth for
  // what the user actually got. Populated when tx-status sees a real tx.
  coinbaseSellUsdc?: number; // USDC actually sold (sell_amount.value)
  coinbaseTotalUsd?: number; // USD net to user after fees (total.value)
  coinbaseFeeUsd?: number;   // Coinbase fee (coinbase_fee.value)
  coinbaseExchangeRate?: number; // exchange_rate.value
  // For diagnostics
  errorMessage?: string;
  // For direct withdrawals — stash the original withdrawal doc id so admin
  // can cross-reference with /api/admin/withdrawals if needed.
  withdrawalId?: string;
}

/**
 * Log a freshly-created offramp session. Returns the doc id (caller can
 * stash it in the user's session/localStorage if they want guaranteed
 * matching later, but lookup-by-most-recent works fine for sequential flows).
 */
export async function logOfframpSessionCreated(input: {
  userId: string;
  walletAddress?: string;
  partnerUserId?: string;
  amount?: number;
  paymentMethod?: string;
  draftId?: string;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) {
    console.warn('[Offramp Audit] Firestore not configured, skipping log');
    return null;
  }
  try {
    const now = new Date().toISOString();
    const db = getAdminFirestore();
    const doc: Partial<OfframpAttempt> = {
      userId: input.userId,
      source: 'coinbase_offramp',
      timestamp: now,
      updatedAt: now,
      status: 'session_created' as OfframpAttemptStatus,
    };
    if (input.walletAddress) doc.walletAddress = input.walletAddress;
    if (input.partnerUserId) doc.partnerUserId = input.partnerUserId;
    if (typeof input.amount === 'number') doc.amount = input.amount;
    if (input.paymentMethod) doc.paymentMethod = input.paymentMethod;
    if (input.draftId) doc.draftId = input.draftId;
    const ref = await db.collection(OFFRAMP_COLLECTION).add(doc);
    return ref.id;
  } catch (err) {
    console.error('[Offramp Audit] logOfframpSessionCreated failed:', err);
    return null;
  }
}

/**
 * Log a direct withdrawal (USDC to user wallet, or future direct bank rail).
 * These don't go through Coinbase, so they aren't subject to tx-status
 * polling — they're either already settled at creation or queued for
 * processing. Status maps to whatever createWithdrawal returned.
 */
export async function logDirectWithdrawal(input: {
  userId: string;
  walletAddress?: string;
  amount: number;
  method: 'usdc' | 'bank';
  withdrawalId?: string;
  status: 'tx_pending' | 'tx_completed' | 'tx_failed';
  errorMessage?: string;
  draftId?: string;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const now = new Date().toISOString();
    const db = getAdminFirestore();
    const doc: Partial<OfframpAttempt> = {
      userId: input.userId,
      source: input.method === 'bank' ? 'direct_bank' : 'direct_usdc',
      timestamp: now,
      updatedAt: now,
      status: input.status,
      amount: input.amount,
      paymentMethod: input.method,
    };
    if (input.walletAddress) doc.walletAddress = input.walletAddress;
    if (input.withdrawalId) doc.withdrawalId = input.withdrawalId;
    if (input.errorMessage) doc.errorMessage = input.errorMessage;
    if (input.draftId) doc.draftId = input.draftId;
    if (input.status === 'tx_completed') doc.txCompletedAt = now;
    const ref = await db.collection(OFFRAMP_COLLECTION).add(doc);

    // Surface completed cashouts in the user's activity feed. Direct
    // withdrawals can land 'tx_completed' on creation when the Go API
    // returns 'completed' synchronously; otherwise it'll be emitted later
    // when status flips (currently no flip path for direct — backend status
    // updates would land here in the future).
    if (input.status === 'tx_completed') {
      logActivityEvent({
        type: 'cashout_completed',
        userId: input.userId,
        walletAddress: input.walletAddress ?? null,
        metadata: {
          amount: input.amount,
          rail: doc.source,
          method: input.method,
        },
      }).catch(() => { /* non-fatal */ });
    }
    return ref.id;
  } catch (err) {
    console.error('[Offramp Audit] logDirectWithdrawal failed:', err);
    return null;
  }
}

/**
 * When tx-status polling sees a Coinbase tx for a user, find the user's most
 * recent open attempt and patch it with the tx state. Mapping to a SPECIFIC
 * attempt requires Coinbase to return a partnerUserId on the tx (it does);
 * we match by userId + earliest matching open attempt by timestamp.
 *
 * Returns the doc id we updated, or null if no open attempt was found.
 */
export async function updateOfframpFromTx(input: {
  userId: string;
  coinbaseTxId: string;
  coinbaseTxStatus: string;
  // Optional precise numbers from Coinbase's tx object — when present,
  // these become the source of truth for the activity feed (settled USD)
  // and admin reconciliation (fees, exchange rate).
  coinbaseSellUsdc?: number;
  coinbaseTotalUsd?: number;
  coinbaseFeeUsd?: number;
  coinbaseExchangeRate?: number;
}): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    // Look for the most recent open (non-terminal) attempt for this user.
    // We don't filter on status server-side because Firestore composite
    // indexes are a hassle — fetch a few, filter in-memory.
    const snap = await db
      .collection(OFFRAMP_COLLECTION)
      .where('userId', '==', input.userId)
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    const target = snap.docs.find((d) => {
      const data = d.data() as OfframpAttempt;
      return data.status === 'session_created' || data.status === 'tx_pending';
    });
    if (!target) return null;

    const newStatus: OfframpAttemptStatus = mapCoinbaseStatusToOfframp(input.coinbaseTxStatus);
    const now = new Date().toISOString();
    const update: Partial<OfframpAttempt> = {
      status: newStatus,
      updatedAt: now,
      coinbaseTxId: input.coinbaseTxId,
      coinbaseTxStatus: input.coinbaseTxStatus,
    };
    if (typeof input.coinbaseSellUsdc === 'number') update.coinbaseSellUsdc = input.coinbaseSellUsdc;
    if (typeof input.coinbaseTotalUsd === 'number') update.coinbaseTotalUsd = input.coinbaseTotalUsd;
    if (typeof input.coinbaseFeeUsd === 'number') update.coinbaseFeeUsd = input.coinbaseFeeUsd;
    if (typeof input.coinbaseExchangeRate === 'number') update.coinbaseExchangeRate = input.coinbaseExchangeRate;
    const existing = target.data() as OfframpAttempt;
    if (!existing.txDetectedAt) update.txDetectedAt = now;
    const isFirstCompletion = newStatus === 'tx_completed' && !existing.txCompletedAt;
    if (isFirstCompletion) {
      update.txCompletedAt = now;
    }
    await target.ref.set(update, { merge: true });

    // Surface the completed cashout in the user's activity feed exactly
    // once — guard on the previous doc's txCompletedAt so repeated polls
    // can't re-emit. Prefer Coinbase's reported settled USD (post-fee) —
    // that's what actually lands in the user's bank, the truthful number
    // to show. Fall back to the user-requested USDC amount only when
    // Coinbase didn't report it.
    if (isFirstCompletion) {
      const settledUsd = input.coinbaseTotalUsd ?? null;
      const requestedUsdc = existing.amount ?? null;
      logActivityEvent({
        type: 'cashout_completed',
        userId: existing.userId,
        walletAddress: existing.walletAddress ?? null,
        metadata: {
          // 'amount' is what the activity feed renders. Use settled USD
          // when Coinbase gave it to us; otherwise the requested USDC.
          amount: settledUsd ?? requestedUsdc,
          // Both kept for diagnostics and any future UI that wants to
          // show "you cashed out 100 USDC and received $99.40".
          settledUsd,
          requestedUsdc,
          coinbaseFeeUsd: input.coinbaseFeeUsd ?? null,
          rail: existing.source,
          method: existing.paymentMethod,
          coinbaseTxId: input.coinbaseTxId,
        },
      }).catch(() => { /* non-fatal */ });
    }
    return target.id;
  } catch (err) {
    console.error('[Offramp Audit] updateOfframpFromTx failed:', err);
    return null;
  }
}

/**
 * Mark a direct withdrawal as paid — the Gnosis Safe batch has gone out
 * and USDC has landed in the user's wallet. Emits the cashout_completed
 * activity event exactly once (guarded against re-fires) and flips the
 * matching offramp_attempt to tx_completed.
 *
 * Idempotent: calling twice is safe — the activity event will not fire
 * a second time because we check the offramp_attempt's prior status.
 */
export async function markDirectWithdrawalPaid(input: {
  withdrawalId: string;
  userId: string;          // canonical lowercase wallet
  walletAddress?: string;
  amount: number;
  method: 'usdc' | 'bank';
  txHash?: string;         // optional — gnosis batch tx hash, for audit
}): Promise<{ activityEmitted: boolean }> {
  if (!isFirestoreConfigured()) return { activityEmitted: false };

  const db = getAdminFirestore();
  const now = new Date().toISOString();

  // Find the offramp_attempt by withdrawalId. There SHOULD be exactly one;
  // we take the most recent if somehow multiple. If none exists (legacy
  // withdrawals from before audit logging), we still emit the activity
  // event so the user sees "money sent" in their feed.
  let alreadyCompleted = false;
  let attemptId: string | null = null;
  try {
    const snap = await db
      .collection(OFFRAMP_COLLECTION)
      .where('withdrawalId', '==', input.withdrawalId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
    if (snap.size > 0) {
      const doc = snap.docs[0];
      const data = doc.data() as OfframpAttempt;
      attemptId = doc.id;
      alreadyCompleted = data.status === 'tx_completed';
      if (!alreadyCompleted) {
        const update: Partial<OfframpAttempt> = {
          status: 'tx_completed',
          updatedAt: now,
          txCompletedAt: now,
        };
        await doc.ref.set(update, { merge: true });
      }
    } else {
      // No prior offramp_attempt — backfill one in tx_completed state so
      // admin still sees this in the offramp dashboard.
      const newDoc: Partial<OfframpAttempt> = {
        userId: input.userId,
        source: input.method === 'bank' ? 'direct_bank' : 'direct_usdc',
        timestamp: now,
        updatedAt: now,
        status: 'tx_completed',
        amount: input.amount,
        paymentMethod: input.method,
        withdrawalId: input.withdrawalId,
        txCompletedAt: now,
      };
      if (input.walletAddress) newDoc.walletAddress = input.walletAddress;
      const ref = await db.collection(OFFRAMP_COLLECTION).add(newDoc);
      attemptId = ref.id;
    }
  } catch (err) {
    console.error('[Offramp Audit] markDirectWithdrawalPaid offramp update failed:', err);
  }

  // Only fire the activity event if we haven't already. Without this guard
  // an admin double-clicking "Mark paid" would post duplicate activity.
  if (alreadyCompleted) return { activityEmitted: false };

  try {
    await logActivityEvent({
      type: 'cashout_completed',
      userId: input.userId,
      walletAddress: input.walletAddress ?? null,
      txHash: input.txHash ?? null,
      metadata: {
        amount: input.amount,
        // For direct withdrawals, requested USDC = settled value (no fee
        // or slippage), so we put the same number in both fields for
        // schema parity with Coinbase events.
        settledUsd: input.amount,
        requestedUsdc: input.amount,
        rail: input.method === 'bank' ? 'direct_bank' : 'direct_usdc',
        method: input.method,
        withdrawalId: input.withdrawalId,
        offrampAttemptId: attemptId,
      },
    });
  } catch (err) {
    console.error('[Offramp Audit] markDirectWithdrawalPaid activity event failed:', err);
    return { activityEmitted: false };
  }

  return { activityEmitted: true };
}

/**
 * Map Coinbase's transaction status strings to our offramp status enum.
 * Coinbase uses things like 'pending', 'in_progress', 'completed',
 * 'failed', 'declined' depending on the API surface. Be loose on input,
 * tight on output.
 */
function mapCoinbaseStatusToOfframp(s: string): OfframpAttemptStatus {
  const normalized = (s || '').toLowerCase();
  if (normalized.includes('complete') || normalized === 'success' || normalized === 'paid') {
    return 'tx_completed';
  }
  if (normalized.includes('fail') || normalized.includes('declin') || normalized === 'cancelled' || normalized === 'rejected') {
    return 'tx_failed';
  }
  return 'tx_pending';
}

/**
 * Reconcile session_created Coinbase offramp entries against Coinbase's
 * actual sell-transaction state. Lets admin see real outcomes (failed
 * / completed / pending) on rows where the user closed our modal
 * before tx-status polling could update.
 */
async function reconcileSessionCreatedOfframps(
  attempts: Array<OfframpAttempt & { id: string }>,
  maxReconciliations = 20,
): Promise<Array<OfframpAttempt & { id: string }>> {
  if (!isFirestoreConfigured()) return attempts;

  const candidates = attempts
    .filter((a) =>
      a.source === 'coinbase_offramp' &&
      a.status === 'session_created' &&
      !!a.partnerUserId,
    )
    .slice(0, maxReconciliations);
  if (candidates.length === 0) return attempts;

  const byPartner = new Map<string, Array<OfframpAttempt & { id: string }>>();
  for (const a of candidates) {
    const key = a.partnerUserId!;
    if (!byPartner.has(key)) byPartner.set(key, []);
    byPartner.get(key)!.push(a);
  }

  const db = getAdminFirestore();
  const updates: Array<Promise<unknown>> = [];
  const updatedById = new Map<string, OfframpAttempt & { id: string }>();

  await Promise.all(Array.from(byPartner.entries()).map(async ([partnerUserId, group]) => {
    let txs: OfframpTransaction[] = [];
    try {
      const res = await getUserOfframpTransactions(partnerUserId, 10);
      txs = res.transactions;
    } catch (err) {
      console.warn('[Offramp Audit] reconcile fetch failed for', partnerUserId, (err as Error).message);
      return;
    }

    for (const attempt of group) {
      const sessionMs = Date.parse(attempt.timestamp);
      const candidate = txs.find((t) => {
        const ts = Date.parse(t.created_at);
        return Number.isFinite(ts) && ts >= sessionMs - 60_000;
      });
      if (!candidate) continue;

      const newStatus = mapCoinbaseStatusToOfframp(candidate.status);
      const now = new Date().toISOString();
      const numOrUndef = (s?: string): number | undefined => {
        if (!s) return undefined;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const update: Partial<OfframpAttempt> = {
        status: newStatus,
        updatedAt: now,
        coinbaseTxId: candidate.id,
        coinbaseTxStatus: candidate.status,
        coinbaseSellUsdc: numOrUndef(candidate.sell_amount?.value),
        coinbaseTotalUsd: numOrUndef(candidate.total?.value),
        coinbaseFeeUsd: numOrUndef(candidate.coinbase_fee?.value),
        coinbaseExchangeRate: numOrUndef(candidate.exchange_rate?.value),
      };
      if (!attempt.txDetectedAt) update.txDetectedAt = now;
      if (newStatus === 'tx_completed' && !attempt.txCompletedAt) {
        update.txCompletedAt = now;
      }

      updates.push(
        db.collection(OFFRAMP_COLLECTION).doc(attempt.id).set(update, { merge: true }),
      );
      updatedById.set(attempt.id, { ...attempt, ...update } as OfframpAttempt & { id: string });
    }
  }));

  Promise.all(updates).catch(() => { /* best-effort */ });
  return attempts.map((a) => updatedById.get(a.id) ?? a);
}

/**
 * List recent offramp attempts. Default 50, filterable by status + userId.
 * Side effects:
 *  - Lazily marks old session_created attempts as abandoned (1h+).
 *  - Reconciles session_created Coinbase rows against Coinbase's
 *    actual sell-transaction state — so admin sees real outcomes
 *    even when users closed the modal before tx-status could update.
 */
export async function listOfframpAttempts(opts: {
  limit?: number;
  status?: OfframpAttemptStatus;
  userId?: string;
}): Promise<Array<OfframpAttempt & { id: string }>> {
  if (!isFirestoreConfigured()) return [];
  try {
    const db = getAdminFirestore();
    let q = db.collection(OFFRAMP_COLLECTION).orderBy('timestamp', 'desc');
    if (opts.status) q = q.where('status', '==', opts.status);
    if (opts.userId) q = q.where('userId', '==', opts.userId);
    const snap = await q.limit(opts.limit ?? 50).get();

    const now = Date.now();
    const result: Array<OfframpAttempt & { id: string }> = [];
    const abandonUpdates: Array<Promise<unknown>> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as OfframpAttempt;
      if (
        data.status === 'session_created' &&
        Date.parse(data.timestamp) < now - ABANDONED_THRESHOLD_MS
      ) {
        const updated = { ...data, status: 'abandoned' as OfframpAttemptStatus, updatedAt: new Date().toISOString() };
        abandonUpdates.push(doc.ref.set(updated, { merge: true }));
        result.push({ id: doc.id, ...updated });
      } else {
        result.push({ id: doc.id, ...data });
      }
    }
    Promise.all(abandonUpdates).catch(() => { /* ignore */ });

    return await reconcileSessionCreatedOfframps(result);
  } catch (err) {
    console.error('[Offramp Audit] listOfframpAttempts failed:', err);
    return [];
  }
}
