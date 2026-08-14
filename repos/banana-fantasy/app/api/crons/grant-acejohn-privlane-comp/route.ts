/**
 * ⚠️ ONE-SHOT (Richard 2026-08-14, remove after run): grant 1 FREE Draft Pass
 * to AceJohn — comp for the private-league entry mix-up (ticket-2681): his
 * free pass went to public BBB #675 while he was trying to enter his KoD/KFFL
 * private league. Same internals as /api/admin/grant-drafts (on-chain
 * reserveTokens mint, pass_origin admin_grant, Go register free, inventory
 * recount, activity event, audit log, grant bell) — server-side where the
 * mint key lives, because the admin JWT path can't be scripted.
 *
 * Guards: cron-style auth (x-vercel-cron or CRON_SECRET) + a create-once
 * guard doc so it can NEVER run twice, even if left deployed.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet, isAdminMintConfigured } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recountFromInventory } from '@/lib/passLedger';
import { logAdminAction } from '@/lib/adminAudit';
import { logger } from '@/lib/logger';

const REASON = 'Private league entry mix-up comp (ticket-2681)';
const ACTOR = 'one-shot-acejohn-privlane-comp-richard';
const WALLET = '0x32ffd97f914baa03caca2af98919c3eaf91070c3'; // AceJohn

function authed(req: Request): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminMintConfigured()) return NextResponse.json({ error: 'mint not configured' }, { status: 503 });
  const db = getAdminFirestore();

  // one-shot guard — .create() throws if it ever ran before
  try {
    await db.collection('one_shot_guards').doc('grant-acejohn-privlane-comp').create({ at: FieldValue.serverTimestamp() });
  } catch {
    return NextResponse.json({ error: 'already ran' }, { status: 409 });
  }

  try {
    const userRef = db.collection('v2_users').doc(WALLET);
    const before = ((await userRef.get()).data()?.freeDrafts as number | undefined) ?? 0;

    const { txHash, tokenIds } = await reserveTokensToWallet({ to: WALLET, count: 1 });
    const ids = tokenIds.map(String);
    await recordPassOrigins({ tokenIds: ids, origin: 'admin_grant', ownerAtMint: WALLET, txHash, reason: REASON });
    await registerMintedTokens(WALLET, tokenIds, 'free');
    const counts = await recountFromInventory(WALLET);
    await userRef.set({ walletAddress: WALLET }, { merge: true });

    await db.collection('v2_activity_events').add({
      type: 'pass_granted', userId: WALLET, walletAddress: WALLET,
      username: null, walletType: 'unknown',
      paymentMethod: 'free', quantity: 1, tokenIds: ids, txHash,
      metadata: { adminActor: ACTOR, mintedOnChain: true, reason: REASON },
      devicePlatform: null, userAgent: null,
      createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(),
    });
    await logAdminAction({
      actor: ACTOR, action: 'grant-drafts', target: WALLET,
      before: { freeDrafts: before },
      after: { freeDrafts: counts.freeDrafts, granted: 1, txHash, tokenIds: ids },
      requestId: `one-shot-acejohn-privlane-${ids[0]}`,
    });
    await db.collection('marketplace_notifications').add({
      wallet: WALLET, type: 'promo',
      title: 'Free Draft Pass Granted',
      message: 'The SBS Team sent you a Free Draft Pass to your account.',
      link: '/drafting', read: false, createdAt: FieldValue.serverTimestamp(),
    });

    logger.info('one_shot_acejohn_privlane.granted', { wallet: WALLET, tokenIds: ids, txHash });
    return NextResponse.json({ results: [{ wallet: WALLET, ok: true, tokenIds: ids, txHash, freeDrafts: counts.freeDrafts }] });
  } catch (e) {
    logger.error('one_shot_acejohn_privlane.failed', { wallet: WALLET, err: (e as Error).message });
    return NextResponse.json({ results: [{ wallet: WALLET, ok: false, error: (e as Error).message }] }, { status: 500 });
  }
}
