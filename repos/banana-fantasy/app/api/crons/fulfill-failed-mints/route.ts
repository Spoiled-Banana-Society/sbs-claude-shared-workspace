import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recountFromInventory } from '@/lib/passLedger';

export const dynamic = 'force-dynamic';

/**
 * Auto-fulfillment cron for owed draft passes.
 *
 * When a purchase's payment succeeds but the mint fails (e.g. a nonce
 * collision on the shared admin wallet), the user has PAID but received no
 * NFT. The card-mint route records that in `failed_mints` with retryable=true.
 * Before this cron, nothing ever delivered those owed passes — the user was
 * left out of pocket. This runs every few minutes, re-mints the owed passes,
 * registers them as spendable, refreshes the user's pass count, and marks the
 * record resolved. Taking money and not delivering the NFT is never acceptable;
 * this closes that gap automatically — no support ticket, no admin action.
 *
 * Safety:
 *  - Each record is CLAIMED in a transaction (resolved=true) before minting, so
 *    two overlapping runs can't double-mint. On mint failure the claim is
 *    released (resolved=false) for the next run, until MAX_ATTEMPTS, after which
 *    it's flagged needsManual for a human.
 *  - Auth: Vercel Cron's `Authorization: Bearer ${CRON_SECRET}`.
 */

const FAILED_MINTS_COLLECTION = 'failed_mints';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_PER_RUN = 10;
const MAX_ATTEMPTS = 8;

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (!isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

  const db = getAdminFirestore();

  // Pull a batch of retryable records. Old records pre-date the `resolved`
  // field, so we filter resolved/attempts in code rather than in the query.
  const snap = await db
    .collection(FAILED_MINTS_COLLECTION)
    .where('retryable', '==', true)
    .limit(MAX_PER_RUN * 3)
    .get();

  const results: Array<{ id: string; userId: string; status: string; detail?: string }> = [];
  let processed = 0;

  for (const doc of snap.docs) {
    if (processed >= MAX_PER_RUN) break;
    const data = doc.data();
    if (data.resolved === true) continue;
    const attempts = (data.attempts as number | undefined) ?? 0;
    if (attempts >= MAX_ATTEMPTS) continue; // already flagged for manual handling

    const userId = String(data.userId ?? '').toLowerCase();
    const quantity = Number(data.quantity ?? 0);
    if (!WALLET_REGEX.test(userId) || !Number.isInteger(quantity) || quantity <= 0) {
      await doc.ref.set({ resolved: true, resolvedReason: 'invalid_record', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ id: doc.id, userId, status: 'skipped_invalid' });
      continue;
    }

    // CLAIM: transactionally mark resolved=true so a concurrent run skips it.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data()?.resolved === true) return false;
      tx.set(doc.ref, { resolved: true, attempts: attempts + 1, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) continue;

    processed++;
    try {
      const mintResult = await reserveTokensToWallet({ to: userId, count: quantity });
      try {
        await registerMintedTokens(userId, mintResult.tokenIds, 'paid');
      } catch (e) {
        logger.warn('fulfill-failed-mints.register_failed', { userId, err: (e as Error).message });
      }
      try {
        await recountFromInventory(userId);
      } catch (e) {
        logger.warn('fulfill-failed-mints.recount_failed', { userId, err: (e as Error).message });
      }
      await doc.ref.set(
        {
          resolved: true,
          resolvedAt: FieldValue.serverTimestamp(),
          mintTxHash: mintResult.txHash,
          mintedTokenIds: mintResult.tokenIds,
        },
        { merge: true },
      );
      logger.info('fulfill-failed-mints.delivered', { userId, quantity, txHash: mintResult.txHash });
      results.push({ id: doc.id, userId, status: 'delivered', detail: mintResult.txHash });
    } catch (err) {
      // Mint still failing — release the claim so the next run retries, unless
      // we've hit the attempt ceiling, in which case flag for a human.
      const exhausted = attempts + 1 >= MAX_ATTEMPTS;
      await doc.ref.set(
        {
          resolved: false,
          needsManual: exhausted,
          lastError: (err as Error).message?.slice(0, 300) ?? 'unknown',
          lastTriedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.error('fulfill-failed-mints.retry_failed', { userId, attempts: attempts + 1, exhausted, err: (err as Error).message });
      results.push({ id: doc.id, userId, status: exhausted ? 'exhausted_needs_manual' : 'retry_failed' });
    }
  }

  return json({ processed, results });
}
