import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recountFromInventory } from '@/lib/passLedger';
import { buildActivityEventDoc } from '@/lib/activityEvents';

const USERS_COLLECTION = 'v2_users';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

function normalizeWallet(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const body = await parseBody(req);
    const rawIdentifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const count = Number(body.count);

    if (!rawIdentifier) throw new ApiError(400, 'Missing identifier (wallet or username)');
    if (!Number.isFinite(count) || !Number.isInteger(count) || count === 0) {
      throw new ApiError(400, 'count must be a non-zero integer');
    }
    if (Math.abs(count) > 1000) throw new ApiError(400, 'count out of range (max 1000)');

    logger.info('admin.grant_drafts.request', { requestId, actor: actorWallet, identifier: rawIdentifier, count });

    const db = getAdminFirestore();

    // Resolution strategy:
    //   - If admin typed a wallet address: mint directly to that wallet. That is the
    //     authoritative target — no "look up doc.walletAddress and use that instead"
    //     (which used to mint to the seeded mock wallet if the doc had stale data).
    //     Look up or create a user doc with that wallet as the doc id so counters
    //     and notifications still work.
    //   - If admin typed a username: look up the user doc by username and use the
    //     wallet on file (must exist). If none, error.
    let targetWallet: string | null = null;
    let userDocId: string | null = null;
    let resolvedUsername: string | null = null;
    let beforeFreeDrafts = 0;

    if (WALLET_REGEX.test(rawIdentifier)) {
      targetWallet = normalizeWallet(rawIdentifier);
      userDocId = targetWallet;
      const direct = await db.collection(USERS_COLLECTION).doc(targetWallet).get();
      if (direct.exists) {
        const data = direct.data();
        resolvedUsername = (data?.username as string) ?? null;
        beforeFreeDrafts = (data?.freeDrafts as number | undefined) ?? 0;
      }
      // No doc yet is fine — we'll create one lazily in the update below.
    } else {
      const snap = await db
        .collection(USERS_COLLECTION)
        .where('username', '==', rawIdentifier)
        .limit(1)
        .get();
      if (snap.empty) {
        throw new ApiError(404, `User not found for "${rawIdentifier}"`);
      }
      userDocId = snap.docs[0].id;
      const data = snap.docs[0].data();
      const docWallet = typeof data.walletAddress === 'string' ? normalizeWallet(data.walletAddress) : null;
      // Prefer the doc's wallet field if it looks real; otherwise fall back to the
      // doc id (which is the wallet in most of our data). Never use the mock seed.
      if (docWallet && WALLET_REGEX.test(docWallet) && !docWallet.startsWith('0x1234567890abcdef')) {
        targetWallet = docWallet;
      } else if (WALLET_REGEX.test(userDocId)) {
        targetWallet = normalizeWallet(userDocId);
      } else {
        throw new ApiError(422, `User "${rawIdentifier}" has no real wallet on file — ask them to log in once first`);
      }
      resolvedUsername = (data.username as string) ?? null;
      beforeFreeDrafts = (data.freeDrafts as number | undefined) ?? 0;
    }

    const userRef = db.collection(USERS_COLLECTION).doc(userDocId);

    // On-chain mint happens first so we don't move the Firestore counter if the
    // tx fails. We still dual-write the counter so read paths that haven't been
    // moved to on-chain-derived counts (admin UI, user balance) stay accurate.
    const mintOnChain = isAdminMintConfigured() && count > 0;
    let txHash: string | undefined;
    let mintedTokenIds: string[] = [];

    if (mintOnChain) {
      const res = await reserveTokensToWallet({ to: targetWallet, count });
      txHash = res.txHash;
      mintedTokenIds = res.tokenIds;
      await recordPassOrigins({
        tokenIds: mintedTokenIds,
        origin: 'admin_grant',
        ownerAtMint: targetWallet,
        txHash,
        reason: `admin_grant:${actorWallet}`,
      });
      // Register into the Go engine as REAL spendable free tokens (awaited),
      // so the granted pass is actually usable. Collision-proof on the engine
      // side, so reused ids no longer drop the token.
      try {
        await registerMintedTokens(targetWallet, mintedTokenIds, 'free');
      } catch (e) {
        logger.warn('admin.grant_drafts.register_go_api_failed', { requestId, target: userDocId, err: (e as Error).message });
      }
    }

    // Recount freeDrafts from the wallet's REAL spendable inventory — a mirror,
    // not a blind increment — with the pass_granted activity event in the same
    // transaction. If on-chain mint wasn't configured (no token created), the
    // count simply doesn't move: we never grant a phantom pass that the draft
    // engine can't honor.
    let newFreeDrafts = beforeFreeDrafts;
    if (count > 0) {
      const activityDoc = await buildActivityEventDoc({
        type: 'pass_granted',
        userId: userDocId,
        walletAddress: targetWallet,
        paymentMethod: 'free',
        quantity: count,
        tokenIds: mintedTokenIds,
        txHash: txHash ?? null,
        metadata: {
          adminActor: actorWallet.toLowerCase(),
          mintedOnChain: mintOnChain,
        },
      });
      const counts = await recountFromInventory(targetWallet, activityDoc);
      newFreeDrafts = counts.freeDrafts;
      await userRef.set({ walletAddress: targetWallet }, { merge: true });
      if (!mintOnChain) {
        logger.warn('admin.grant_drafts.no_onchain_mint_counter_unchanged', {
          requestId, target: userDocId, count,
        });
      }
    } else {
      // 0-count case: just ensure the wallet field is set, no counter change.
      await userRef.set({ walletAddress: targetWallet }, { merge: true });
    }

    await logAdminAction({
      actor: actorWallet,
      action: 'grant-drafts',
      target: userDocId,
      before: { freeDrafts: beforeFreeDrafts },
      after: {
        freeDrafts: newFreeDrafts,
        granted: count,
        ...(txHash ? { txHash, tokenIds: mintedTokenIds } : {}),
      },
      requestId,
    });

    try {
      const title = count > 0 ? 'Free Drafts Granted!' : 'Drafts Adjusted';
      const message = mintOnChain
        ? `We just minted ${count} free draft pass NFT${count !== 1 ? 's' : ''} to your wallet.`
        : count > 0
          ? `You received ${count} free draft${count !== 1 ? 's' : ''}. You now have ${newFreeDrafts} total.`
          : `An admin adjusted your free drafts by ${count}. You now have ${newFreeDrafts} total.`;
      await db.collection('marketplace_notifications').add({
        wallet: targetWallet,
        type: 'promo',
        title,
        message,
        link: '/drafting',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (notifyErr) {
      logger.warn('admin.grant_drafts.notify_failed', { requestId, err: notifyErr });
    }

    // (Activity event was written atomically with the counter mutation above.)

    logger.info('admin.grant_drafts.ok', {
      requestId,
      actor: actorWallet,
      target: userDocId,
      recipient: targetWallet,
      before: beforeFreeDrafts,
      after: newFreeDrafts,
      granted: count,
      mintOnChain,
      txHash,
      tokenIds: mintedTokenIds,
      durationMs: Date.now() - start,
    });

    return json({
      success: true,
      userId: userDocId,
      walletAddress: targetWallet,
      username: resolvedUsername,
      granted: count,
      freeDrafts: newFreeDrafts,
      mintOnChain,
      txHash,
      tokenIds: mintedTokenIds,
      requestId,
    });
  } catch (err) {
    logger.error('admin.grant_drafts.failed', {
      requestId,
      actor: actorWallet,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
