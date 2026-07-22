/**
 * ⚠️ ONE-SHOT (Boris 2026-07-22, remove after run): grant 1 FREE Draft Pass to
 * the 7 human drafters of BBB #217 (2026-fast-draft-206) — mid-draft freeze
 * compensation. Runs the SAME internals as /api/admin/grant-drafts (on-chain
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

const REASON = 'BBB #217 mid-draft freeze comp';
const ACTOR = 'one-shot-217-comp-boris';
const WALLETS = [
  '0xa551f64ae2791d0fc6c8cad23c22ac3529dbbd2e', // Banana69
  '0x0438d7119e84767b23267634f752422ce48db0ad', // MrMcNasty
  '0x17b76551ff8d26d692da2b9ba02dea9d3ecdde55', // UsedCarSales
  '0xeffc7bb82b1495b9b14394ff891d1e14e1f17c8f', // NickW
  '0x32ffd97f914baa03caca2af98919c3eaf91070c3', // AceJohn
  '0x6cf606d59e5fc2aa1f8fdf758a9264d1dd5486a4', // TheBigJernana
  '0x696012486d4629baa75e0f44a481f127f6705e1e', // Vertig0
];

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
    await db.collection('one_shot_guards').doc('grant-217-comp').create({ at: FieldValue.serverTimestamp() });
  } catch {
    return NextResponse.json({ error: 'already ran' }, { status: 409 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const w of WALLETS) {
    try {
      const userRef = db.collection('v2_users').doc(w);
      const before = ((await userRef.get()).data()?.freeDrafts as number | undefined) ?? 0;

      const { txHash, tokenIds } = await reserveTokensToWallet({ to: w, count: 1 });
      const ids = tokenIds.map(String);
      await recordPassOrigins({ tokenIds: ids, origin: 'admin_grant', ownerAtMint: w, txHash, reason: REASON });
      await registerMintedTokens(w, tokenIds, 'free');
      const counts = await recountFromInventory(w);
      await userRef.set({ walletAddress: w }, { merge: true });

      await db.collection('v2_activity_events').add({
        type: 'pass_granted', userId: w, walletAddress: w,
        username: null, walletType: 'unknown',
        paymentMethod: 'free', quantity: 1, tokenIds: ids, txHash,
        metadata: { adminActor: ACTOR, mintedOnChain: true, reason: REASON },
        devicePlatform: null, userAgent: null,
        createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(),
      });
      await logAdminAction({
        actor: ACTOR, action: 'grant-drafts', target: w,
        before: { freeDrafts: before },
        after: { freeDrafts: counts.freeDrafts, granted: 1, txHash, tokenIds: ids },
        requestId: `one-shot-217-${ids[0]}`,
      });
      await db.collection('marketplace_notifications').add({
        wallet: w, type: 'promo',
        title: 'Free Draft Pass Granted',
        message: 'The SBS Team sent you a Free Draft Pass to your account.',
        link: '/drafting', read: false, createdAt: FieldValue.serverTimestamp(),
      });

      results.push({ wallet: w, ok: true, tokenIds: ids, txHash, freeDrafts: counts.freeDrafts });
      logger.info('one_shot_217.granted', { wallet: w, tokenIds: ids, txHash });
    } catch (e) {
      results.push({ wallet: w, ok: false, error: (e as Error).message });
      logger.error('one_shot_217.failed', { wallet: w, err: (e as Error).message });
    }
  }
  return NextResponse.json({ results });
}
