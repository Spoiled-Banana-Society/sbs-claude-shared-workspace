import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { writeDraftPassMetadata } from '@/lib/nftCardServer';
import { recountFromInventory } from '@/lib/passLedger';
import { buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { incrementMintPromos, incrementReferralPromos, notifyPassPurchased } from '@/lib/db';
import { feeForQty, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { pushStreamEventBg } from '@/lib/userEventStream';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const USERS_COLLECTION = 'v2_users';
const FAILED_MINTS_COLLECTION = 'failed_mints';
// Idempotency markers for the card-fee → free-draft accumulator, keyed by the
// mint txHash so a retried mint can never double-credit / double-grant.
const CARD_FEE_CREDIT_COLLECTION = 'card_fee_credits';

export interface PaidMintContext {
  /** Buyer wallet (lowercased). */
  userId: string;
  /** Paid pass quantity. */
  quantity: number;
  /** 'card' (MoonPay/Coinbase onramp) or 'usdc' (direct USDC). Card payments
   *  accrue the card-fee → free-draft credit; USDC purchases don't. */
  paymentMethod: 'card' | 'usdc';
  /** Onramp partner for the activity-feed source label (card path only). */
  cardProvider: 'moonpay' | 'coinbase' | null;
  /** Total USDC paid (6-dec units). */
  value: bigint;
  /** Permit deadline (unix seconds) — for the activity event metadata. */
  deadlineNum: number;
  /** Payment tx references for the activity event (chain-specific). For the NY
   *  path these are the Optimism permit / sweep hashes. */
  permitTxHash: string;
  transferTxHash?: string;
  /** The result of the on-chain reserveTokens mint the caller already ran. */
  mintResult: { txHash: string; tokenIds: string[] };
}

export interface PaidMintBookkeepingResult {
  draftPasses: number | null;
  promoAwards: { mintMilestonesEarned: number; buyBonusMilestonesEarned: number; firstPurchaseSpinsEarned: number };
  cardFreeDraftsEarned: number;
}

/**
 * Everything a paid draft-pass purchase does AFTER the on-chain mint lands:
 * register the tokens as `paid`, run the card-fee→free-draft credit, recount the
 * ledger, write the activity event + purchase bell, bump promos/referrals, and
 * log onramp completion.
 *
 * NY-ONLY. This is a faithful COPY of `card-mint/route.ts`'s post-mint
 * bookkeeping (lines ~347-576), used exclusively by the NY Optimism route so a
 * NY buyer gets an IDENTICAL paid pass — same paid status, same card-fee credit,
 * same promos. card-mint itself is deliberately NOT refactored to call this: the
 * Base flow every other buyer uses stays byte-for-byte untouched (zero risk).
 * ⚠️ KEEP IN SYNC: if card-mint's post-mint bookkeeping changes, mirror it here.
 * The caller owns the payment step (Optimism sweep) and the reserveTokens mint;
 * this owns all post-mint bookkeeping. Runs AFTER the admin-wallet lock is
 * released (the reward mint below serializes on its own).
 */
export async function bookkeepPaidMint(ctx: PaidMintContext): Promise<PaidMintBookkeepingResult> {
  const { userId, quantity, paymentMethod, cardProvider, value, deadlineNum, permitTxHash, transferTxHash, mintResult } = ctx;

  // 3b. Register the minted tokens into the Go engine as REAL spendable tokens,
  //     typed `paid`. AWAITED — the draftPasses counter below is recomputed from
  //     the resulting inventory, so it can only reflect tokens that actually
  //     landed. Collision-proof on the engine side, so reused ids no longer drop.
  try {
    await registerMintedTokens(userId, mintResult.tokenIds, 'paid');
  } catch (e) {
    logger.warn('paidMint.register_go_api_failed', { userId, err: (e as Error).message });
  }
  // Grey pre-reveal draft-pass image for each fresh token (real token id → #).
  // waitUntil-backed — a detached write dies with the frozen lambda.
  runInBackground('mint.pass-metadata', writeDraftPassMetadata(mintResult.tokenIds));

  // 4. Card-fee credit → free draft (card payments only). Credit the MoonPay fee
  //    for this quantity (feeForQty) toward a free draft; once accumulated card
  //    fees reach $25, grant paid-type draft(s) and roll over the remainder.
  //    Atomic + idempotent per mint txHash (marker doc) so a retry can never
  //    double-credit / double-grant. USDC purchases pay no card fee → no credit.
  let rewardEarned = 0;
  let rewardRolloverCents = 0;
  let rewardTokenIds: string[] = [];
  let rewardMintTxHash: string | undefined;

  if (isFirestoreConfigured() && paymentMethod === 'card') {
    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const markerRef = db.collection(CARD_FEE_CREDIT_COLLECTION).doc(mintResult.txHash.toLowerCase());
    const feeCents = feeForQty(quantity);
    try {
      const res = await db.runTransaction(async (tx) => {
        const marker = await tx.get(markerRef);
        if (marker.exists) return { duplicate: true, earned: 0, rolloverCents: 0 };
        const userSnap = await tx.get(userRef);
        const cur = Math.max(0, (userSnap.data()?.cardFeeCreditCents as number | undefined) ?? 0);
        const credit = cur + feeCents;
        const earned = Math.floor(credit / FREE_DRAFT_CREDIT_CENTS);
        const rolloverCents = credit % FREE_DRAFT_CREDIT_CENTS;
        tx.set(userRef, { cardFeeCreditCents: rolloverCents }, { merge: true });
        tx.set(markerRef, {
          txHash: mintResult.txHash.toLowerCase(),
          userId,
          quantity,
          feeCents,
          earned,
          status: earned > 0 ? 'pending' : 'credited',
          createdAt: FieldValue.serverTimestamp(),
        });
        return { duplicate: false, earned, rolloverCents };
      });
      if (res.duplicate) {
        logger.info(LOG_SOURCES.payment.REWARD_DUPLICATE_SKIPPED, { userId, txHash: mintResult.txHash });
      } else {
        rewardEarned = res.earned;
        rewardRolloverCents = res.rolloverCents;
        logger.info(LOG_SOURCES.payment.FEE_CREDITED, {
          userId, quantity, feeCents, rolloverCents: res.rolloverCents, earned: res.earned,
        });
      }
    } catch (creditErr) {
      // Non-fatal: the on-chain mint already succeeded. A missed credit is
      // recoverable; never roll back the paid mint over a credit write.
      logger.warn('paidMint.fee_credit_failed', { userId, err: (creditErr as Error).message });
    }
  }

  // 4b. If the credit crossed $25, mint the earned draft(s) as PAID-type (usable
  //     in promos) BEFORE the recount so the counter reflects them.
  if (rewardEarned > 0) {
    try {
      const rewardMint = await reserveTokensToWallet({ to: userId, count: rewardEarned });
      rewardTokenIds = rewardMint.tokenIds;
      rewardMintTxHash = rewardMint.txHash;
      // Register as 'paid' (NOT 'free' / no free-origin stamp) so the reward
      // draft is a normal usable pass — enterable in promos.
      await registerMintedTokens(userId, rewardMint.tokenIds, 'paid');
      runInBackground('mint.reward-pass-metadata', writeDraftPassMetadata(rewardMint.tokenIds));
      try {
        await getAdminFirestore()
          .collection(CARD_FEE_CREDIT_COLLECTION)
          .doc(mintResult.txHash.toLowerCase())
          .set({ status: 'granted', rewardTokenIds: rewardMint.tokenIds, rewardMintTxHash: rewardMint.txHash }, { merge: true });
      } catch { /* marker status update is best-effort */ }
      logger.info(LOG_SOURCES.payment.REWARD_GRANTED, {
        userId, earned: rewardEarned, rolloverCents: rewardRolloverCents,
        rewardTxHash: rewardMintTxHash, tokenIds: rewardTokenIds,
      });
    } catch (rewardErr) {
      // Credit was already consumed but the reward mint failed → the user is
      // owed a draft. CRITICAL (matches ^payment\.) + recorded for re-grant.
      logger.error(LOG_SOURCES.payment.REWARD_GRANT_FAILED, {
        userId, earned: rewardEarned, sourceTxHash: mintResult.txHash, err: (rewardErr as Error).message,
      });
      try {
        await getAdminFirestore().collection(FAILED_MINTS_COLLECTION).add({
          source: 'card_reward', userId, quantity: rewardEarned,
          sourceTxHash: mintResult.txHash, error: (rewardErr as Error).message,
          createdAt: FieldValue.serverTimestamp(), retryable: true,
        });
      } catch { /* failed-mint record is best-effort */ }
      rewardEarned = 0; // don't fire a "you earned a draft" event we couldn't fulfill
    }
  }

  // 5. draftPasses recounted from real inventory (purchase + any reward tokens).
  //    pass_purchased activity event written in the same recount tx.
  let newDraftPasses: number | null = null;
  const activityInput = {
    type: 'pass_purchased' as const,
    userId,
    walletAddress: userId,
    paymentMethod,
    quantity,
    tokenIds: mintResult.tokenIds,
    txHash: mintResult.txHash,
    metadata: {
      source: paymentMethod === 'card'
        ? (cardProvider === 'coinbase' ? 'card_coinbase_permit' : 'card_moonpay_permit')
        : 'usdc_permit',
      ...(paymentMethod === 'card' && cardProvider ? { cardProvider } : {}),
      permitDeadline: deadlineNum,
      permitTxHash,
      transferTxHash,
      totalPrice: Number(value) / 1_000_000,
      currency: 'USDC',
    },
  };

  if (isFirestoreConfigured()) {
    try {
      const activityDoc = await buildActivityEventDoc(activityInput);
      const counts = await recountFromInventory(userId, activityDoc);
      newDraftPasses = counts.draftPasses;
    } catch (recErr) {
      console.error('[paidMint] recount failed, falling back to activity log:', recErr);
      logger.warn('paidMint.recount_failed', { userId, err: (recErr as Error).message });
      await logActivityEvent({ ...activityInput, metadata: { ...activityInput.metadata, fallbackPath: true } }).catch(() => {});
    }
  } else {
    await logActivityEvent(activityInput);
  }

  // Bell: real-time confirmation for every successful pass buy (Boris).
  await notifyPassPurchased(userId, quantity, mintResult.txHash);

  // 5b. Reward activity event → shows live in the admin LiveActivity feed.
  if (rewardEarned > 0) {
    await logActivityEvent({
      type: 'pass_granted',
      userId,
      walletAddress: userId,
      paymentMethod: 'free',
      quantity: rewardEarned,
      tokenIds: rewardTokenIds,
      txHash: rewardMintTxHash ?? null,
      metadata: {
        source: 'card_fee_reward',
        creditConsumedCents: FREE_DRAFT_CREDIT_CENTS * rewardEarned,
        rolloverCents: rewardRolloverCents,
        sourceTxHash: mintResult.txHash,
      },
    }).catch((e) => logger.warn('paidMint.reward_activity_failed', { userId, err: (e as Error).message }));
  }

  // 6. Bump Buy 10 + Buy 2 promo progress and referrer milestones — for the PAID
  //    purchase `quantity` only; the reward draft never advances promos.
  //    Best-effort — must not roll back the on-chain mint (already happened).
  let promoAwards = { mintMilestonesEarned: 0, buyBonusMilestonesEarned: 0, firstPurchaseSpinsEarned: 0 };
  if (isFirestoreConfigured()) {
    try {
      promoAwards = await incrementMintPromos(userId, quantity);
    } catch (promoErr) {
      logger.warn('paidMint.promo_increment_failed', { userId, quantity, err: (promoErr as Error).message });
    }
    try {
      await incrementReferralPromos(userId, quantity);
    } catch (refErr) {
      logger.warn('paidMint.referral_increment_failed', { userId, quantity, err: (refErr as Error).message });
    }
  }

  // Onramp audit: log a tx_completed entry so admin dashboard shows successful
  // purchases alongside failures.
  if (paymentMethod === 'card' && cardProvider) {
    try {
      const { logOnrampCompleted } = await import('@/lib/onrampAudit');
      await logOnrampCompleted({
        userId,
        walletAddress: userId,
        provider: cardProvider,
        amount: Number(value) / 1_000_000,
        passQuantity: quantity,
        mintTxHash: mintResult.txHash,
      });
    } catch (err) {
      logger.warn('paidMint.onramp_audit_failed', { userId, err: (err as Error).message });
    }
  }

  // Happy-path observability for ALL NFT purchases (card + USDC).
  logger.info(LOG_SOURCES.payment.PURCHASE_COMPLETED, {
    userId,
    quantity,
    paymentMethod,
    cardProvider: cardProvider ?? undefined,
    txHash: mintResult.txHash,
    valueUsdc: Number(value) / 1_000_000,
    rewardEarned,
  });

  // Post-commit: fire the synced bell + bottom toast when a free draft was earned
  // from card-fee credit. Best-effort; never blocks the response.
  if (rewardEarned > 0) {
    pushStreamEventBg(userId, 'promo-card-free-draft', { awardedCount: rewardEarned });
  }

  return { draftPasses: newDraftPasses, promoAwards, cardFreeDraftsEarned: rewardEarned };
}
