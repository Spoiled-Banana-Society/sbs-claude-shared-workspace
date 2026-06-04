export const dynamic = 'force-dynamic';

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
  USDC_PERMIT_ABI,
} from '@/lib/contracts/bbb4';
import {
  getAdminWalletAddress,
  isAdminMintConfigured,
  pullUsdcFromUser,
  reserveTokensToWallet,
  submitUsdcPermit,
} from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recountFromInventory } from '@/lib/passLedger';
import { parsePermitSignature } from '@/lib/onchain/usdcPermit';
import { buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { incrementMintPromos, incrementReferralPromos } from '@/lib/db';
import { feeForQty, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { pushStreamEvent } from '@/lib/userEventStream';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const USERS_COLLECTION = 'v2_users';
const FAILED_MINTS_COLLECTION = 'failed_mints';
// Idempotency markers for the card-fee → free-draft accumulator, keyed by the
// mint txHash so a retried card-mint can never double-credit / double-grant.
const CARD_FEE_CREDIT_COLLECTION = 'card_fee_credits';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_QUANTITY = 40;

// Floor at which the admin wallet can reliably submit the permit +
// transferFrom + reserveTokens trio. We pin gas params to 0.1 gwei
// max in adminMint.ts (vs Base's actual ~0.005 gwei base fee), so a
// full mint pre-funds at ~0.0001 ETH of viem-required headroom. Floor
// at 5× that so transient spikes don't lock us out.
const ADMIN_WALLET_GAS_FLOOR_WEI = 500_000_000_000_000n; // 0.0005 ETH (~$1.50)

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

/**
 * POST /api/purchases/card-mint
 *
 * Gasless mint via EIP-2612 permit. The user signs an off-chain USDC
 * permit (no wallet gas prompt), and the admin wallet executes three txs:
 *   1. USDC.permit(user, adminWallet, value, deadline, v, r, s)
 *   2. USDC.transferFrom(user, BBB4_CONTRACT_ADDRESS, value)
 *   3. BBB4.reserveTokens(user, quantity)
 *
 * Works for every wallet type (Privy embedded, MetaMask, Coinbase, etc.).
 * Staging-only during soak — promote to prod after a verification pass.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Admin mint not configured (BBB4_OWNER_PRIVATE_KEY missing)', 503);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    if (!WALLET_REGEX.test(userId)) {
      return jsonError('userId must be a wallet address', 400);
    }

    const quantityRaw = body.quantity;
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return jsonError(`quantity must be an integer between 1 and ${MAX_QUANTITY}`, 400);
    }

    const deadlineRaw = body.deadline;
    const deadlineNum =
      typeof deadlineRaw === 'number'
        ? deadlineRaw
        : typeof deadlineRaw === 'string'
          ? Number(deadlineRaw)
          : NaN;
    if (!Number.isFinite(deadlineNum)) {
      return jsonError('deadline must be a unix timestamp (seconds)', 400);
    }
    if (deadlineNum < Math.floor(Date.now() / 1000)) {
      return jsonError('deadline has already passed', 400);
    }
    const deadline = BigInt(Math.floor(deadlineNum));

    const signatureStr = requireString(body.signature, 'signature');
    const signature = (signatureStr.startsWith('0x') ? signatureStr : `0x${signatureStr}`) as Hex;
    let parsedSig: { v: number; r: Hex; s: Hex };
    try {
      parsedSig = parsePermitSignature(signature);
    } catch (err) {
      return jsonError(`invalid signature: ${(err as Error).message}`, 400);
    }

    const paymentMethodRaw = body.paymentMethod;
    const paymentMethod: 'card' | 'usdc' =
      paymentMethodRaw === 'card' ? 'card' : 'usdc';
    // Which onramp provider the card path went through. Optional —
    // when missing we fall back to 'moonpay' for backward compat
    // since that was the only option before the Coinbase route was
    // added. Used to label the activity-feed event source.
    const cardProviderRaw = body.cardProvider;
    const cardProvider: 'moonpay' | 'coinbase' | null =
      cardProviderRaw === 'coinbase' ? 'coinbase'
      : cardProviderRaw === 'moonpay' ? 'moonpay'
      : null;

    const adminWallet = getAdminWalletAddress();
    if (!adminWallet) {
      return jsonError('Admin wallet address unavailable', 503);
    }
    const owner = userId as Address;

    // Pre-flight: ensure the admin wallet has enough ETH to cover the
    // three on-chain txs we're about to submit. If it doesn't, fail fast
    // with a 503 BEFORE the user signs the permit so we don't burn their
    // nonce or leave an orphaned allowance.
    const adminEthBalance = await publicClient.getBalance({ address: adminWallet });
    if (adminEthBalance < ADMIN_WALLET_GAS_FLOOR_WEI) {
      logger.error('card-mint.admin_wallet_low_balance', {
        adminWallet,
        balanceWei: adminEthBalance.toString(),
        floorWei: ADMIN_WALLET_GAS_FLOOR_WEI.toString(),
      });
      return jsonError(
        'Purchases are temporarily paused for maintenance. Your funds are safe — please try again in a few minutes.',
        503,
      );
    }

    // Read on-chain price + user's current permit nonce. The client also
    // read these to build the signature; re-reading here guards against
    // price manipulation and stale-nonce replays.
    const [tokenPriceUsdc, onchainNonce, mintIsActive] = await Promise.all([
      publicClient.readContract({
        address: BBB4_CONTRACT_ADDRESS,
        abi: BBB4_ABI,
        functionName: 'TOKEN_PRICE_USDC',
      }),
      publicClient.readContract({
        address: BASE_SEPOLIA_USDC_ADDRESS,
        abi: USDC_PERMIT_ABI,
        functionName: 'nonces',
        args: [owner],
      }),
      publicClient.readContract({
        address: BBB4_CONTRACT_ADDRESS,
        abi: BBB4_ABI,
        functionName: 'mintIsActive',
      }),
    ]);

    if (!mintIsActive) {
      return jsonError('Mint is not active on the BBB4 contract', 400);
    }

    const value = (tokenPriceUsdc as bigint) * BigInt(quantity);

    // 1. Consume the user's permit. Admin wallet now has allowance.
    let permitTxHash: Hex;
    try {
      permitTxHash = await submitUsdcPermit({
        owner,
        spender: adminWallet,
        value,
        deadline,
        v: parsedSig.v,
        r: parsedSig.r,
        s: parsedSig.s,
      });
    } catch (err) {
      logger.warn('card-mint.permit_failed', {
        userId,
        quantity,
        nonce: (onchainNonce as bigint).toString(),
        err: (err as Error).message,
      });
      if (err instanceof ApiError) return jsonError(err.message, err.status);
      return jsonError(`Permit failed: ${(err as Error).message}`, 400);
    }

    // 2. Pull USDC into the BBB4 contract. Existing skim-bbb4-usdc cron will
    //    sweep it to COLD_TREASURY_ADDRESS on its hourly schedule.
    let transferTxHash: Hex;
    try {
      transferTxHash = await pullUsdcFromUser({
        owner,
        to: BBB4_CONTRACT_ADDRESS,
        amount: value,
      });
    } catch (err) {
      logger.error('card-mint.transferFrom_failed', {
        userId,
        quantity,
        value: value.toString(),
        permitTxHash,
        err: (err as Error).message,
      });
      if (err instanceof ApiError) return jsonError(err.message, err.status);
      return jsonError(`USDC transfer failed: ${(err as Error).message}`, 402);
    }

    // 3. Admin-mint the NFTs to the user. If this fails after transferFrom
    //    succeeded, we owe the user a pass — record for retry.
    let mintResult: { txHash: Hex; tokenIds: string[] };
    try {
      mintResult = await reserveTokensToWallet({ to: userId, count: quantity });
    } catch (err) {
      logger.error('card-mint.mint_failed_after_payment', {
        userId,
        quantity,
        value: value.toString(),
        permitTxHash,
        transferTxHash,
        err: (err as Error).message,
      });
      if (isFirestoreConfigured()) {
        try {
          const db = getAdminFirestore();
          await db.collection(FAILED_MINTS_COLLECTION).add({
            source: 'card-mint',
            userId,
            quantity,
            value: value.toString(),
            paymentMethod,
            permitTxHash,
            transferTxHash,
            error: (err as Error).message,
            createdAt: FieldValue.serverTimestamp(),
            retryable: true,
            resolved: false,
            attempts: 0,
          });
        } catch (logErr) {
          logger.error('card-mint.failed_mint_record_error', { userId, err: logErr });
        }
      }
      return jsonError(
        'Your payment went through and your draft pass is on its way — it has been queued and will be delivered automatically, usually within a few minutes. You will NOT be charged again. If it hasn’t shown up shortly, contact support and we’ll sort it out right away.',
        500,
        { paymentSucceeded: true },
      );
    }

    // 3b. Register the minted tokens into the Go engine as REAL spendable
    //     tokens, typed `paid`. AWAITED — the draftPasses counter below is
    //     recomputed from the resulting inventory, so it can only reflect
    //     tokens that actually landed. Collision-proof on the engine side, so
    //     reused ids no longer drop the token.
    try {
      await registerMintedTokens(userId, mintResult.tokenIds, 'paid');
    } catch (e) {
      logger.warn('card-mint.register_go_api_failed', { userId, err: (e as Error).message });
    }

    // 4. Card-fee credit → free draft (card payments only). Credit the MoonPay
    //    fee for this quantity (feeForQty) toward a free draft; once accumulated
    //    card fees reach $25, grant paid-type draft(s) and roll over the
    //    remainder. Atomic + idempotent per mint txHash (marker doc) so a retry
    //    can never double-credit or double-grant. USDC purchases pay no card
    //    fee, so they never accrue credit.
    let rewardEarned = 0;
    let rewardRolloverCents = 0;
    let rewardTokenIds: string[] = [];
    let rewardMintTxHash: string | undefined;

    if (isFirestoreConfigured() && paymentMethod === 'card') {
      const db = getAdminFirestore();
      const userRef = db.collection(USERS_COLLECTION).doc(userId);
      const markerRef = db
        .collection(CARD_FEE_CREDIT_COLLECTION)
        .doc(mintResult.txHash.toLowerCase());
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
        logger.warn('card-mint.fee_credit_failed', { userId, err: (creditErr as Error).message });
      }
    }

    // 4b. If the credit crossed $25, mint the earned draft(s) as PAID-type
    //     (usable in promos) BEFORE the recount so the counter reflects them.
    if (rewardEarned > 0) {
      try {
        const rewardMint = await reserveTokensToWallet({ to: userId, count: rewardEarned });
        rewardTokenIds = rewardMint.tokenIds;
        rewardMintTxHash = rewardMint.txHash;
        // Register as 'paid' (NOT 'free' / no free-origin stamp) so the reward
        // draft is a normal usable pass — enterable in promos.
        await registerMintedTokens(userId, rewardMint.tokenIds, 'paid');
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

    // 5. draftPasses recounted from real inventory (purchase + any reward
    //    tokens). pass_purchased activity event written in the same recount tx.
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
        // 'source' encodes both the rail and the onramp partner so admin
        // reporting can split MoonPay vs Coinbase volume without joining
        // tables. Falls back to MoonPay when paymentMethod is 'card' but
        // no provider was specified (backward compat for older clients).
        source: paymentMethod === 'card'
          ? (cardProvider === 'coinbase' ? 'card_coinbase_permit' : 'card_moonpay_permit')
          : 'usdc_permit',
        ...(paymentMethod === 'card' && cardProvider
          ? { cardProvider }
          : {}),
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
        console.error('[card-mint] recount failed, falling back to activity log:', recErr);
        logger.warn('card-mint.recount_failed', { userId, err: (recErr as Error).message });
        await logActivityEvent({ ...activityInput, metadata: { ...activityInput.metadata, fallbackPath: true } }).catch(() => {});
      }
    } else {
      await logActivityEvent(activityInput);
    }

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
      }).catch((e) => logger.warn('card-mint.reward_activity_failed', { userId, err: (e as Error).message }));
    }

    // 6. Bump Buy 10 + Buy 2 promo progress and referrer milestones — for the
    //    PAID purchase `quantity` only; the reward draft never advances promos.
    //    Best-effort — must not roll back the on-chain mint (already happened).
    if (isFirestoreConfigured()) {
      try {
        await incrementMintPromos(userId, quantity);
      } catch (promoErr) {
        logger.warn('card-mint.promo_increment_failed', {
          userId,
          quantity,
          err: (promoErr as Error).message,
        });
      }
      try {
        await incrementReferralPromos(userId, quantity);
      } catch (refErr) {
        logger.warn('card-mint.referral_increment_failed', {
          userId,
          quantity,
          err: (refErr as Error).message,
        });
      }
    }

    // Onramp audit: log a tx_completed entry so admin dashboard
    // shows successful purchases alongside failures. Updates the
    // existing Coinbase session record if open; creates a fresh
    // record for MoonPay (which has no session_created step).
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
        logger.warn('card-mint.onramp_audit_failed', { userId, err: (err as Error).message });
      }
    }

    // Happy-path observability for ALL NFT purchases (card + USDC). info-level
    // → structured logs / dev export, NOT the critical error feed.
    logger.info(LOG_SOURCES.payment.PURCHASE_COMPLETED, {
      userId,
      quantity,
      paymentMethod,
      cardProvider: cardProvider ?? undefined,
      txHash: mintResult.txHash,
      valueUsdc: Number(value) / 1_000_000,
      rewardEarned,
    });

    // Post-commit: fire the synced bell + bottom toast when a free draft was
    // earned from card-fee credit. Best-effort; never blocks the response.
    if (rewardEarned > 0) {
      void pushStreamEvent(userId, 'promo-card-free-draft', { awardedCount: rewardEarned });
    }

    return json({
      success: true,
      minted: quantity,
      tokenIds: mintResult.tokenIds,
      draftPasses: newDraftPasses,
      txHashes: {
        permit: permitTxHash,
        transferFrom: transferTxHash,
        mint: mintResult.txHash,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('card-mint.unhandled', { err: (err as Error).message });
    logger.error(LOG_SOURCES.payment.MINT_FAILED, {
      err: (err as Error).message,
      stack: (err as Error).stack,
    });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
