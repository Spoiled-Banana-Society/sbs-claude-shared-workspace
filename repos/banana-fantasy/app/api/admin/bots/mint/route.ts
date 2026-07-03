export const dynamic = 'force-dynamic';
// Bulk sequential on-chain mints — give the function room.
export const maxDuration = 300;

import { NextRequest } from 'next/server';
import { ethers } from 'ethers';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/bots/mint  — admin-gated ops tool (admin login or x-bot-secret).
 *
 * Builds the house "bot" wallet pool. For each bot it:
 *   1. generates a fresh wallet ADDRESS (no key stored — bots are fully
 *      server-operated: the admin mints to them, they join + auto-draft
 *      server-side, and they never sign anything),
 *   2. mints a REAL on-chain BBB4 pass to that address,
 *   3. registers the token in the Go engine as `free` (so it's a spendable
 *      free draft that reveals into a real on-chain team — counted free, so it
 *      never earns promos/King/badges),
 *   4. records it in `botWallets` — the registry we use to identify bots and
 *      exclude them from prizes/stats at playoff time.
 *
 * On-chain to bots is identical to how every real free-draft player's team is
 * minted (owner -> wallet), so bots are on-chain-indistinguishable from real
 * free-draft users except by deliberate clustering analysis. The default
 * identity (Banana##### + plain banana pfp) renders automatically for any
 * wallet with no custom profile, so we set NO profile on bots.
 *
 * Capped per call to stay inside the function budget — call again to grow the
 * pool toward the target size.
 */
const BOT_COLLECTION = 'botWallets';
const MAX_PER_CALL = 10;

export async function POST(req: NextRequest) {
  try {
    await requireBotAuth(req);
    if (!isAdminMintConfigured()) {
      return jsonError('Admin mint not configured (BBB4_OWNER_PRIVATE_KEY missing)', 503);
    }
    if (!isFirestoreConfigured()) {
      return jsonError('Firestore not configured', 503);
    }

    const body = await parseBody(req);
    const count = typeof body.count === 'number' ? body.count : Number(body.count);
    if (!Number.isInteger(count) || count <= 0) {
      return jsonError('count must be a positive integer', 400);
    }
    if (count > MAX_PER_CALL) {
      return jsonError(`capped at ${MAX_PER_CALL} bots per call — call again to grow the pool`, 400);
    }

    const db = getAdminFirestore();
    const created: Array<{ address: string; tokenIds: string[]; txHash: string }> = [];
    const failed: Array<{ address: string; error: string }> = [];

    // Sequential (not parallel): each mint is its own on-chain tx, and Base
    // nonce lag makes back-to-back parallel mints collide. The admin write path
    // has retry, but serializing is the clean way to keep nonces ordered.
    for (let i = 0; i < count; i++) {
      const address = ethers.Wallet.createRandom().address.toLowerCase();
      try {
        const { txHash, tokenIds } = await reserveTokensToWallet({ to: address, count: 1 });
        const idStrs = tokenIds.map((t) => String(t));
        try {
          await registerMintedTokens(address, tokenIds, 'free');
        } catch (e) {
          logger.warn('bots.mint.register_failed', { address, err: (e as Error).message });
        }
        await db.collection(BOT_COLLECTION).doc(address).set(
          {
            isBot: true,
            address,
            tokenIds: idStrs,
            passType: 'free',
            mintTxHash: txHash,
            createdAt: Date.now(),
          },
          { merge: true },
        );
        created.push({ address, tokenIds: idStrs, txHash });
      } catch (e) {
        failed.push({ address, error: (e as Error).message });
        logger.warn('bots.mint.failed', { address, err: (e as Error).message });
      }
    }

    return json({ success: true, poolAdded: created.length, created, failed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.mint.unhandled', { route: '/api/admin/bots/mint', err });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
