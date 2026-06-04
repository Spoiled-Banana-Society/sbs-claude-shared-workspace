import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Distributed lock for the shared admin/ops wallet (0xccdF…441D).
 *
 * The wallet signs USDC permits, transferFroms, and reserveTokens mints for
 * EVERY purchase, grant, and wheel reward. Because it's ONE wallet doing a
 * multi-step sequence (approve → pull → mint), two operations running at once
 * race on (a) the tx nonce and (b) the USDC allowance — which surfaced as
 * "replacement transaction underpriced" and "transfer amount exceeds allowance"
 * failures. Holding this lock around an entire on-chain sequence guarantees the
 * steps run atomically: no interleaving, no nonce/allowance race.
 *
 * Lease-based with auto-expiry so a crashed/timed-out holder can't deadlock the
 * wallet — a stale lock past its lease is reclaimable.
 */

const LOCK_COLLECTION = 'system_locks';
const LOCK_DOC = 'admin-wallet';
const LEASE_MS = 90_000; // a full purchase (3 txs + receipts) fits comfortably
const MAX_WAIT_MS = 60_000; // how long to wait to acquire before giving up
const POLL_MS = 750;

function lockRef() {
  return getAdminFirestore().collection(LOCK_COLLECTION).doc(LOCK_DOC);
}

async function tryAcquire(holder: string): Promise<boolean> {
  const db = getAdminFirestore();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef());
    const data = snap.data();
    const now = Date.now();
    const expiresAt = (data?.expiresAtMs as number | undefined) ?? 0;
    if (data?.locked === true && expiresAt > now) {
      return false; // held and not expired
    }
    tx.set(
      lockRef(),
      { locked: true, holder, acquiredAt: FieldValue.serverTimestamp(), expiresAtMs: now + LEASE_MS },
      { merge: true },
    );
    return true;
  });
}

async function release(holder: string): Promise<void> {
  const db = getAdminFirestore();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef());
      // Only the current holder clears it — a reclaimed-after-expiry lock won't
      // be stomped by the original (now-finished) holder.
      if (snap.data()?.holder === holder) {
        tx.set(lockRef(), { locked: false, releasedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
  } catch (e) {
    logger.warn('adminWalletLock.release_failed', { holder, err: (e as Error).message });
  }
}

/**
 * Acquire the admin-wallet lock, waiting up to MAX_WAIT_MS. Returns a release
 * function the caller MUST call (in a finally) when its on-chain sequence is
 * done. If Firestore isn't configured or the lock can't be acquired in time,
 * returns a no-op release and proceeds unlocked — better to attempt the user's
 * purchase (the per-tx nonce retry is the backstop) than to hard-fail it.
 *
 * Use this around a MULTI-step sequence (permit → pull → mint) so nothing can
 * interleave between the steps.
 */
export async function acquireAdminWalletLock(label: string): Promise<() => Promise<void>> {
  const noop = async () => {};
  if (!isFirestoreConfigured()) return noop;
  const holder = `${label}:${Date.now()}:${process.hrtime.bigint().toString(36)}`;
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      if (await tryAcquire(holder)) return () => release(holder);
    } catch (e) {
      logger.warn('adminWalletLock.acquire_error', { label, err: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  logger.warn('adminWalletLock.timeout_proceeding', { label, waitedMs: Date.now() - start });
  return noop;
}

/**
 * Run `fn` while holding the admin-wallet lock. Convenience wrapper around
 * acquireAdminWalletLock for single-call sequences (e.g. the fulfillment cron).
 */
export async function withAdminWalletLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireAdminWalletLock(label);
  try {
    return await fn();
  } finally {
    await release();
  }
}
