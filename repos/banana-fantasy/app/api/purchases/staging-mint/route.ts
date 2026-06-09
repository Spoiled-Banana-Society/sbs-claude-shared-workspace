export const dynamic = "force-dynamic";

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { writeDraftPassMetadata } from '@/lib/nftCardServer';
import { recountFromInventory } from '@/lib/passLedger';
import { buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { incrementMintPromos, incrementReferralPromos } from '@/lib/db';
import { logger } from '@/lib/logger';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * POST /api/purchases/staging-mint
 *
 * Quick-mint helper for staging testing. Mints a REAL BBB4 NFT on Base via
 * the `reserveTokens` onlyOwner path, then directly increments the user's
 * Firestore `draftPasses` counter. The SSE balance stream pushes the
 * Firestore change to the client, so the header ticks up within ~200ms.
 *
 * Why direct Firestore writethrough instead of relying on the reconciler /
 * Alchemy webhook: the staging Go API rejects new tokenId registrations,
 * and the staging Alchemy webhook isn't reliably configured. The previous
 * version of this endpoint awaited a reconcile and the user count never
 * updated. Firestore is the user-facing source of truth on staging.
 *
 * Gated to NEXT_PUBLIC_ENVIRONMENT === 'staging' so it can never unlock
 * free mints in prod.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Admin mint not configured (BBB4_OWNER_PRIVATE_KEY missing)', 503);
  }
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    if (!WALLET_REGEX.test(userId)) {
      return jsonError('userId must be a wallet address', 400);
    }

    const quantityRaw = body.quantity;
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return jsonError('quantity must be a positive integer', 400);
    }
    if (quantity > 20) {
      return jsonError('staging mint capped at 20 per call', 400);
    }

    // 1. Real on-chain mint.
    const { txHash, tokenIds } = await reserveTokensToWallet({ to: userId, count: quantity });

    // 1b. Register the freshly-minted tokens into the Go engine as REAL
    //     spendable tokens, typed `paid`. This is what makes the pass usable
    //     for draft entry — with the engine's collision-proof registration it
    //     no longer fails on reused ids. AWAITED (not fire-and-forget): the
    //     counter below is recomputed from the resulting inventory, so the
    //     header can only tick up by tokens that actually landed.
    try {
      await registerMintedTokens(userId, tokenIds, 'paid');
    } catch (e) {
      logger.warn('staging-mint.register_go_api_failed', { userId, err: (e as Error).message });
    }

    // 1c. Give each fresh token the grey pre-reveal draft-pass image (keyed on
    //     the real token id) so it shows the pass on OpenSea/wallet before draft.
    void writeDraftPassMetadata(tokenIds);

    // 2. Recount the counter from the engine's real spendable inventory and
    //    write the activity event in the same transaction. draftPasses becomes
    //    the actual count of paid tokens — never a blind +quantity that could
    //    outrun what registered. Self-healing: if registration partially
    //    failed, the number reflects reality instead of inventing passes.
    let newDraftPasses: number | null = null;
    if (isFirestoreConfigured()) {
      try {
        const activityDoc = await buildActivityEventDoc({
          type: 'pass_purchased',
          userId,
          walletAddress: userId,
          paymentMethod: 'free',
          quantity,
          tokenIds,
          txHash,
          metadata: { source: 'staging_mint_button', mintedOnChain: true },
        });
        const counts = await recountFromInventory(userId, activityDoc);
        newDraftPasses = counts.draftPasses;
      } catch (recErr) {
        logger.warn('staging-mint.recount_failed', { userId, err: (recErr as Error).message });
      }
    } else {
      // Firestore unavailable — log activity best-effort.
      await logActivityEvent({
        type: 'pass_purchased',
        userId,
        walletAddress: userId,
        paymentMethod: 'free',
        quantity,
        tokenIds,
        txHash,
        metadata: { source: 'staging_mint_button', mintedOnChain: true },
      });
    }

    // Note: we deliberately do NOT call reconcilePassesForWallet here.
    // The reconciler reads on-chain ownership via Alchemy's NFT indexer,
    // which lags the JSON-RPC node by a few seconds after a fresh mint.
    // If we fire-and-forget the reconciler after this endpoint's
    // authoritative Firestore write, it can race and overwrite the
    // correct value with a stale lower count (the Alchemy NFT API hasn't
    // indexed the mint yet). The reconciler still runs from the Alchemy
    // Transfer webhook (real-time, signature-verified) and the admin
    // /api/admin/reconcile-passes endpoint — those are the right places
    // for it.

    // Bump Buy 10 + Buy 2 promo progress and referrer milestones.
    // Best-effort: a Firestore failure here must not roll back the on-chain
    // mint (already happened).
    let promoAwards = { mintMilestonesEarned: 0, buyBonusMilestonesEarned: 0, firstPurchaseSpinsEarned: 0 };
    if (isFirestoreConfigured()) {
      try {
        promoAwards = await incrementMintPromos(userId, quantity);
      } catch (promoErr) {
        logger.warn('staging-mint.promo_increment_failed', {
          userId,
          quantity,
          err: (promoErr as Error).message,
        });
      }
      try {
        await incrementReferralPromos(userId, quantity);
      } catch (refErr) {
        logger.warn('staging-mint.referral_increment_failed', {
          userId,
          quantity,
          err: (refErr as Error).message,
        });
      }
    }

    // promoAwards lets the buying device fire its milestone toasts + bell
    // refresh INSTANTLY from this response (mobile's RTDB socket is often
    // suspended; the stream event is the cross-device copy, deduped client-side).
    return json({ success: true, minted: quantity, tokenIds, txHash, draftPasses: newDraftPasses, promoAwards }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('staging-mint.unhandled', { route: '/api/purchases/staging-mint', err });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
