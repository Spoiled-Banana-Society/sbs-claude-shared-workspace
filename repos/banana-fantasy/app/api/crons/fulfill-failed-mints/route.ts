import { FieldValue } from 'firebase-admin/firestore';
import { runInBackground } from '@/lib/serverBackground';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { withAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { recountFromInventory } from '@/lib/passLedger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';

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

  runInBackground('cron.heartbeat', recordCronHeartbeat('fulfill-failed-mints')); // liveness for the watchdog

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
    // Card-mint records write `quantity`; wheel-win records write `count`.
    // Read both so wheel failures aren't discarded as "invalid". (Without this,
    // every wheel-mint failure was silently closed and the user never got their
    // won pass.)
    const quantity = Number(data.quantity ?? data.count ?? 0);
    // Wheel wins are FREE passes; card purchases are PAID. Detect wheel records
    // by their spinId/reason so re-minted passes get the right type + origin.
    const isWheel = !!data.spinId || String(data.reason ?? '').startsWith('wheel_spin');
    const jphofKind: 'jackpot' | 'hof' | 'jackhof' | null =
      data.kind === 'jackpot' || data.kind === 'hof' || data.kind === 'jackhof' ? data.kind : null;
    const passType: 'free' | 'paid' = isWheel ? 'free' : 'paid';
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
      // Hold the admin-wallet lock so this re-mint can't race a live purchase.
      const mintResult = await withAdminWalletLock('fulfill-failed-mints', () =>
        reserveTokensToWallet({ to: userId, count: quantity }),
      );
      // Wheel passes need their on-chain origin recorded (and the JP/HOF Level
      // trait) so the marketplace classifies them correctly — the spin route
      // does this on the happy path; recovery must too.
      if (isWheel) {
        try {
          await recordPassOrigins({
            tokenIds: mintResult.tokenIds,
            origin: 'spin_reward',
            ownerAtMint: userId,
            txHash: mintResult.txHash,
            reason: String(data.reason ?? `wheel_spin:${data.spinId ?? doc.id}`),
            level: jphofKind ?? undefined,
          });
        } catch (e) {
          logger.warn('fulfill-failed-mints.record_origin_failed', { userId, err: (e as Error).message });
        }
      }
      try {
        await registerMintedTokens(userId, mintResult.tokenIds, passType);
      } catch (e) {
        logger.warn('fulfill-failed-mints.register_failed', { userId, err: (e as Error).message });
      }
      // A recovered JP/HOF special isn't done at "minted" — the live wheel path
      // also queues the pass into a filling round and seats the winner. Mirror
      // that here so the winner actually lands in their special-draft lobby.
      if (jphofKind) {
        const jphofTokenId = mintResult.tokenIds[0];
        if (jphofTokenId) {
          try {
            const { joinQueueWithToken } = await import('@/lib/db');
            const { joinedRoundId } = await joinQueueWithToken(userId, jphofKind, jphofTokenId);
            if (joinedRoundId !== null) {
              const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
              await ensureSpecialDraftSeat(jphofKind, joinedRoundId, userId);
            }
          } catch (qErr) {
            logger.warn('fulfill-failed-mints.jphof_queue_failed', { userId, err: (qErr as Error).message });
          }
          try {
            const { refreshOpenSeaTokens } = await import('@/lib/opensea');
            await refreshOpenSeaTokens([jphofTokenId]);
          } catch { /* best-effort; OpenSea re-pulls on its own */ }
        }
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
      // When auto-recovery has GIVEN UP (8 attempts → needsManual), emit a
      // `payment.*` source so it lands in the CRITICAL feed (admin Logs tab +
      // logs.mjs), not buried in warnings. This is the "user paid, never got
      // their pass, the cron quit — a human must re-grant NOW" alarm. See the
      // owed_pass_unfulfilled runbook in lib/logSources.ts.
      if (exhausted) {
        logger.error('payment.card.owed_pass_unfulfilled', {
          userId,
          quantity,
          attempts: attempts + 1,
          failedMintId: doc.id,
          err: (err as Error).message,
        });
      }
      results.push({ id: doc.id, userId, status: exhausted ? 'exhausted_needs_manual' : 'retry_failed' });
    }
  }

  return json({ processed, results });
}
