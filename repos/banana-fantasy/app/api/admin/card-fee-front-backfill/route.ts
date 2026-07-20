import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { writeDraftPassMetadata } from '@/lib/nftCardServer';
import { recountFromInventory } from '@/lib/passLedger';
import { logActivityEvent } from '@/lib/activityEvents';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const USERS_COLLECTION = 'v2_users';
const CARD_FEE_CREDIT_COLLECTION = 'card_fee_credits';
const FAILED_MINTS_COLLECTION = 'failed_mints';

/**
 * One-time backfill for the 2026-07-19 card-fee reward change: the free draft
 * is now FRONTED (first card purchase grants it immediately; every $25 in
 * accumulated fees grants the next). Every user who had already paid card fees
 * under the old wait-for-$25 schedule is owed exactly one fronted pass — this
 * grants it (paid-type mint, same as the purchase path) + a bell explaining
 * the switch, and sets `cardFeeFrontGranted` so the purchase path never
 * double-grants.
 *
 * Batched: processes `limit` users per call (mint + register + recount each,
 * ~5-10s/user) so one invocation stays under the function limit; loop until
 * `remaining` is 0. Idempotent — the flag is only set after a successful mint,
 * and flagged users drop out of the candidate list.
 *
 * Auth: `Authorization: Bearer ${PRIVY_EXPORT_SECRET}` — same local-script
 * admin bearer as privy-users-export.
 */
export async function POST(req: Request) {
  const expected = (process.env.PRIVY_EXPORT_SECRET || '').trim();
  const auth = req.headers.get('authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ error: 'firestore not configured' }, { status: 503 });
  }

  let body: { dryRun?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty body = defaults */ }
  const dryRun = body.dryRun === true;
  const limit = Math.min(10, Math.max(1, Math.floor(body.limit ?? 4)));

  const db = getAdminFirestore();

  // Candidates = anyone who has EVER paid a card fee: current rollover > 0
  // (v2_users) ∪ any card_fee_credits marker (covers users whose credit was
  // consumed exactly at a $25 boundary). Minus anyone already flagged.
  const candidateIds = new Set<string>();
  const creditUsers = await db.collection(USERS_COLLECTION).where('cardFeeCreditCents', '>', 0).get();
  creditUsers.forEach((d) => candidateIds.add(d.id.toLowerCase()));
  const markers = await db.collection(CARD_FEE_CREDIT_COLLECTION).get();
  markers.forEach((d) => {
    const uid = (d.data()?.userId as string | undefined)?.toLowerCase();
    if (uid) candidateIds.add(uid);
  });

  const pending: string[] = [];
  for (const uid of Array.from(candidateIds).sort()) {
    const snap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!snap.exists) continue; // marker for a wallet with no user doc — skip
    if (snap.data()?.cardFeeFrontGranted === true) continue;
    pending.push(uid);
  }

  if (dryRun) {
    return NextResponse.json({ dryRun: true, remaining: pending.length, wallets: pending });
  }

  const processed: Array<{ userId: string; tokenId: string; txHash: string }> = [];
  const failed: Array<{ userId: string; error: string }> = [];

  for (const userId of pending.slice(0, limit)) {
    try {
      const mint = await reserveTokensToWallet({ to: userId, count: 1 });
      // Same post-mint path as the purchase reward: register as 'paid' (usable
      // in promos), then flag + recount + bell. Register failure is non-fatal
      // (purchase path treats it the same); the recount/reconcile heals it.
      try {
        await registerMintedTokens(userId, mint.tokenIds, 'paid');
      } catch (e) {
        logger.warn('cardFeeFrontBackfill.register_go_api_failed', { userId, err: (e as Error).message });
      }
      try {
        await writeDraftPassMetadata(mint.tokenIds);
      } catch { /* pre-reveal image is best-effort */ }
      await db.collection(USERS_COLLECTION).doc(userId).set({ cardFeeFrontGranted: true }, { merge: true });
      try {
        await recountFromInventory(userId);
      } catch (e) {
        logger.warn('cardFeeFrontBackfill.recount_failed', { userId, err: (e as Error).message });
      }
      await logActivityEvent({
        type: 'pass_granted',
        userId,
        walletAddress: userId,
        paymentMethod: 'free',
        quantity: 1,
        tokenIds: mint.tokenIds,
        txHash: mint.txHash,
        metadata: { source: 'card_fee_reward', fronted: 1, backfill: true, creditConsumedCents: 0 },
      }).catch((e) => logger.warn('cardFeeFrontBackfill.activity_failed', { userId, err: (e as Error).message }));
      await createNotification(userId, {
        type: 'promo',
        title: 'Free Paid Draft Pass — card fees now covered',
        message: 'New: we now cover card fees up front. You just got a free Paid Draft Pass for the card fees you’ve already paid — and every $25 in card fees earns you another one, automatically.',
        link: '/drafting',
        dedupeKey: `card-fee-front-backfill-${userId}`,
        icon: 'gift',
      }).catch((e) => logger.warn('cardFeeFrontBackfill.bell_failed', { userId, err: (e as Error).message }));
      processed.push({ userId, tokenId: mint.tokenIds[0], txHash: mint.txHash });
      logger.info('cardFeeFrontBackfill.granted', { userId, tokenIds: mint.tokenIds, txHash: mint.txHash });
    } catch (err) {
      // Mint failed — flag NOT set, so the next run retries this user. Record
      // it like the purchase path does and stop the batch (a mint failure is
      // usually environmental: nonce/gas/RPC — no point burning the rest).
      const msg = (err as Error).message;
      failed.push({ userId, error: msg });
      logger.error('cardFeeFrontBackfill.mint_failed', { userId, err: msg });
      try {
        await db.collection(FAILED_MINTS_COLLECTION).add({
          source: 'card_fee_front_backfill', userId, quantity: 1,
          error: msg, createdAt: FieldValue.serverTimestamp(), retryable: true,
        });
      } catch { /* best-effort */ }
      break;
    }
  }

  return NextResponse.json({
    processed,
    failed,
    remaining: pending.length - processed.length,
  });
}
