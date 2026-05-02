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
import { parsePermitSignature } from '@/lib/onchain/usdcPermit';
import { creditCompletedPurchase } from '@/lib/db';
import { logger } from '@/lib/logger';

const FAILED_MINTS_COLLECTION = 'failed_mints';
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
 *
 * Enabled in any environment that has admin mint configured. Previously
 * hard-gated to staging only — a hardcoded `NEXT_PUBLIC_ENVIRONMENT !==
 * 'staging'` check would 403 every card payment in prod. Switching the
 * env var alone wasn't enough; the route enforces real prerequisites
 * (admin key configured + funded admin wallet + permit signature) so
 * there's no benefit to a separate environment guard.
 */
export async function POST(req: Request) {
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
          });
        } catch (logErr) {
          logger.error('card-mint.failed_mint_record_error', { userId, err: logErr });
        }
      }
      return jsonError(
        'Payment succeeded but mint failed. This has been recorded and will be retried — please contact support if your passes do not appear shortly.',
        500,
      );
    }

    // 4. Atomically credit the user — single source of truth for paid mints.
    //    creditCompletedPurchase covers: v2_purchases doc, draftPasses bump,
    //    wheelSpins, buy-bonus freeDrafts, mint+referral promos,
    //    cardPurchaseCount + 6-card-rewards, single activity event, and
    //    Go-API tokenIds recording. Idempotent on txHash, so a retried
    //    Cloud Tasks invocation can't double-credit.
    let creditResult: Awaited<ReturnType<typeof creditCompletedPurchase>> | null = null;
    if (isFirestoreConfigured()) {
      try {
        creditResult = await creditCompletedPurchase({
          userId,
          quantity,
          paymentMethod,
          txHash: mintResult.txHash,
          tokenIds: mintResult.tokenIds,
          totalPriceUsd: Number(value) / 1_000_000,
          unitPriceUsd: Number(tokenPriceUsdc as bigint) / 1_000_000,
        });
      } catch (creditErr) {
        // The on-chain mint already happened — never throw the route on a
        // post-mint accounting hiccup. Record for replay and continue.
        logger.error('card-mint.credit_failed_after_mint', {
          userId,
          quantity,
          mintTxHash: mintResult.txHash,
          err: (creditErr as Error).message,
        });
        try {
          const db = getAdminFirestore();
          await db.collection(FAILED_MINTS_COLLECTION).add({
            source: 'card-mint-credit',
            userId,
            quantity,
            paymentMethod,
            permitTxHash,
            transferTxHash,
            mintTxHash: mintResult.txHash,
            tokenIds: mintResult.tokenIds,
            error: (creditErr as Error).message,
            createdAt: FieldValue.serverTimestamp(),
            retryable: true,
          });
        } catch (logErr) {
          logger.error('card-mint.failed_credit_record_error', { userId, err: logErr });
        }
      }
    }

    return json({
      success: true,
      minted: quantity,
      tokenIds: mintResult.tokenIds,
      draftPasses: creditResult?.draftPasses ?? null,
      spinsAdded: creditResult?.spinsAdded ?? 0,
      freeDraftsAdded: creditResult?.freeDraftsAdded ?? 0,
      freePassFromRewards: creditResult?.freePassFromRewards ?? false,
      alreadyCredited: creditResult?.alreadyCredited ?? false,
      txHashes: {
        permit: permitTxHash,
        transferFrom: transferTxHash,
        mint: mintResult.txHash,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('card-mint.unhandled', { err: (err as Error).message });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
