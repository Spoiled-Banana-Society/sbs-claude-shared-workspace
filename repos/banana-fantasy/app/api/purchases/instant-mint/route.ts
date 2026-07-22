export const dynamic = 'force-dynamic';

import { createPublicClient, http, erc20Abi, type Address, type Hex } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { paymentsEnabled } from '@/lib/envGates';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
} from '@/lib/contracts/bbb4';
import {
  getAdminWalletAddress,
  isAdminMintConfigured,
  pullUsdcFromUser,
  reserveTokensToWallet,
  submitUsdcPermit,
} from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { writeDraftPassMetadata } from '@/lib/nftCardServer';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { recountFromInventory } from '@/lib/passLedger';
import { parsePermitSignature } from '@/lib/onchain/usdcPermit';
import { buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { incrementMintPromos, incrementReferralPromos, notifyPassPurchased } from '@/lib/db';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

// House-eaten instant entries — every row here is real money the house
// fronted for a seat whose $25 collection failed. Reviewed by hand; the
// critical log line below is the alert.
const HOUSE_EATEN_COLLECTION = 'house_eaten_entries';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ADMIN_WALLET_GAS_FLOOR_WEI = 500_000_000_000_000n; // 0.0005 ETH — card-mint's floor

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

/**
 * POST /api/purchases/instant-mint — deposit bankroll SEAT-FIRST entry
 * (Richard 2026-07-21: "if they have $25 they're good — seat them no matter
 * what, house eats rare collection failures, alert when it happens").
 *
 * Flips card-mint's order. Card-mint: permit → pull $25 → mint (user waits on
 * three txs). Here:
 *   1. VERIFY the wallet holds ≥ $25 USDC and we hold a payment authorization
 *      (permit signature, or a pre-set allowance for smart accounts).
 *   2. Admin-mint the pass IMMEDIATELY (house fronts it — one tx, ~2s) and
 *      register it with the Go engine. Respond. The client then runs the
 *      normal, untouched join flow — user is seated with a REAL pass.
 *   3. Collect the $25 in the BACKGROUND via the authorization. On failure
 *      (balance moved in the window, permit-hostile wallet): the pass stands,
 *      the house eats the $25 — recorded in `house_eaten_entries` + critical
 *      `payment.instant_seat.house_ate` log (admin Logs badge picks it up).
 *
 * Money-truth invariant: the `pass_purchased` activity event (which drives ALL
 * admin revenue) is only written AFTER the $25 verifiably lands. A house-eaten
 * entry never inflates revenue — it writes the house-eat record instead.
 *
 * ⚠️ KEEP IN SYNC with card-mint/route.ts's permit/allowance/transfer
 * machinery — this is deliberately a parallel implementation so the live
 * card-mint path stays byte-for-byte untouched (same convention as
 * bookkeepPaidMint / creditCardDeposit).
 *
 * Quantity is HARD-PINNED to 1: this route exists for one-tap entry, and a
 * bounded blast radius ($25/failure) is what makes house-eats acceptable.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_DEPOSIT_ENABLED !== 'true') {
    return jsonError('Not found', 404);
  }
  if (!paymentsEnabled()) {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Admin mint not configured (BBB4_OWNER_PRIVATE_KEY missing)', 503);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    if (!WALLET_REGEX.test(userId)) {
      return jsonError('userId must be a wallet address', 400);
    }

    const deadlineRaw = body.deadline;
    const deadlineNum =
      typeof deadlineRaw === 'number' ? deadlineRaw
      : typeof deadlineRaw === 'string' ? Number(deadlineRaw)
      : NaN;
    if (!Number.isFinite(deadlineNum)) {
      return jsonError('deadline must be a unix timestamp (seconds)', 400);
    }
    if (deadlineNum < Math.floor(Date.now() / 1000)) {
      return jsonError('deadline has already passed', 400);
    }
    const deadline = BigInt(Math.floor(deadlineNum));

    // Permit optional — smart accounts (EIP-7702) set an on-chain allowance
    // instead and send the '0x' sentinel, exactly like card-mint.
    const signatureStr = typeof body.signature === 'string' ? body.signature : '';
    const hasPermitSig = signatureStr.length > 0 && signatureStr !== '0x';
    const signature = (signatureStr.startsWith('0x') ? signatureStr : `0x${signatureStr}`) as Hex;
    let parsedSig: { v: number; r: Hex; s: Hex } | null = null;
    if (hasPermitSig) {
      try {
        parsedSig = parsePermitSignature(signature);
      } catch (err) {
        return jsonError(`invalid signature: ${(err as Error).message}`, 400);
      }
    }

    const adminWallet = getAdminWalletAddress();
    if (!adminWallet) {
      return jsonError('Admin wallet address unavailable', 503);
    }
    const owner = userId as Address;

    const adminEthBalance = await publicClient.getBalance({ address: adminWallet });
    if (adminEthBalance < ADMIN_WALLET_GAS_FLOOR_WEI) {
      logger.error('instant-mint.admin_wallet_low_balance', {
        adminWallet, balanceWei: adminEthBalance.toString(),
      });
      return jsonError(
        'Purchases are temporarily paused for maintenance. Your funds are safe — please try again in a few minutes.',
        503,
      );
    }

    const [tokenPriceUsdc, mintIsActive, userUsdcBalance, currentAllowance] = await Promise.all([
      publicClient.readContract({
        address: BBB4_CONTRACT_ADDRESS, abi: BBB4_ABI, functionName: 'TOKEN_PRICE_USDC',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: BBB4_CONTRACT_ADDRESS, abi: BBB4_ABI, functionName: 'mintIsActive',
      }),
      publicClient.readContract({
        address: BASE_SEPOLIA_USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [owner],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: BASE_SEPOLIA_USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [owner, adminWallet],
      }) as Promise<bigint>,
    ]);

    if (!mintIsActive) {
      return jsonError('Mint is not active on the BBB4 contract', 400);
    }
    const value = tokenPriceUsdc; // quantity pinned to 1

    // THE gate: $25 in the wallet + an authorization we can collect with.
    // Past this point the user gets seated NO MATTER WHAT happens to the money.
    if (userUsdcBalance < value) {
      return jsonError('Balance too low — add funds and try again. You were NOT charged.', 402);
    }
    if (!parsedSig && currentAllowance < value) {
      return jsonError('Payment authorization missing — please try again. You were NOT charged.', 400);
    }

    // Front the pass NOW (house money, one tx) and register it so the join
    // that follows this response can consume it immediately.
    const releaseAdminLock = await acquireAdminWalletLock('instant-mint');
    let mintResult: { txHash: Hex; tokenIds: string[] };
    try {
      mintResult = await reserveTokensToWallet({ to: userId, count: 1 });
    } catch (err) {
      // Nothing fronted, nothing charged — clean failure, user stays put.
      logger.error('instant-mint.front_mint_failed', { userId, err: (err as Error).message });
      await releaseAdminLock();
      return jsonError('Could not get your pass — please try again. You were NOT charged.', 500);
    }

    try {
      await registerMintedTokens(userId, mintResult.tokenIds, 'paid');
    } catch (e) {
      // Pass minted but engine registration failed — the join would bounce.
      // Surface retryable error; the token sits in the wallet and the standard
      // reconcile sweep registers it, so nothing is lost.
      logger.error('instant-mint.register_failed', { userId, tokenIds: mintResult.tokenIds, err: (e as Error).message });
    }
    runInBackground('instant-mint.pass-metadata', writeDraftPassMetadata(mintResult.tokenIds));

    let newDraftPasses: number | null = null;
    try {
      const counts = await recountFromInventory(userId);
      newDraftPasses = counts.draftPasses;
    } catch { /* counter self-heals via the usual paths */ }

    // ── Respond NOW; the user's join starts immediately. ──────────────────
    // Collection + bookkeeping continue below via waitUntil.
    runInBackground('instant-mint.collect', (async () => {
      let permitTxHash: Hex | 'skipped' = 'skipped';
      let transferTxHash: Hex | undefined;
      let collected = false;
      let lastErr = '';

      // Two attempts: a transient RPC blip shouldn't cost the house $25.
      for (let attempt = 1; attempt <= 2 && !collected; attempt++) {
        try {
          const readAllowance = () =>
            publicClient.readContract({
              address: BASE_SEPOLIA_USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [owner, adminWallet],
            }) as Promise<bigint>;

          if ((await readAllowance()) < value && parsedSig) {
            permitTxHash = await submitUsdcPermit({
              owner, spender: adminWallet, value, deadline,
              v: parsedSig.v, r: parsedSig.r, s: parsedSig.s,
            });
          }
          // Ride out replica lag like card-mint 1b.
          let confirmed = await readAllowance();
          for (let i = 0; confirmed < value && i < 4; i++) {
            await new Promise((r) => setTimeout(r, 600));
            confirmed = await readAllowance();
          }
          if (confirmed < value) throw new Error('allowance never reached price');

          transferTxHash = await pullUsdcFromUser({ owner, to: BBB4_CONTRACT_ADDRESS, amount: value });
          collected = true;
        } catch (err) {
          lastErr = (err as Error).message;
          logger.warn('instant-mint.collect_attempt_failed', { userId, attempt, err: lastErr });
          if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
        }
      }

      if (collected) {
        // Money landed → NOW write the revenue-driving purchase event + promos,
        // mirroring card-mint 3b-onward (minus registration, already done —
        // re-registering post-join would resurrect a consumed pass).
        try {
          const activityInput = {
            type: 'pass_purchased' as const,
            userId,
            walletAddress: userId,
            paymentMethod: 'usdc' as const,
            quantity: 1,
            tokenIds: mintResult.tokenIds,
            txHash: mintResult.txHash,
            metadata: {
              source: 'usdc_permit',
              via: 'instant_seat',
              permitDeadline: Number(deadline),
              permitTxHash,
              transferTxHash,
              totalPrice: Number(value) / 1_000_000,
              currency: 'USDC',
            },
          };
          const activityDoc = await buildActivityEventDoc(activityInput);
          await recountFromInventory(userId, activityDoc);
        } catch (recErr) {
          logger.warn('instant-mint.recount_failed', { userId, err: (recErr as Error).message });
        }
        await notifyPassPurchased(userId, 1, mintResult.txHash).catch(() => {});
        if (isFirestoreConfigured()) {
          await incrementMintPromos(userId, 1).catch((e) =>
            logger.warn('instant-mint.promo_increment_failed', { userId, err: (e as Error).message }));
          await incrementReferralPromos(userId, 1).catch((e) =>
            logger.warn('instant-mint.referral_increment_failed', { userId, err: (e as Error).message }));
        }
        logger.info(LOG_SOURCES.payment.PURCHASE_COMPLETED, {
          userId, quantity: 1, paymentMethod: 'usdc', via: 'instant_seat',
          txHash: mintResult.txHash, transferTxHash, valueUsdc: Number(value) / 1_000_000,
        });
      } else {
        // HOUSE EATS IT. Seat + pass stand; record the loss + fire the alert
        // (payment.* error level = critical feed + admin Logs badge).
        logger.error('payment.instant_seat.house_ate', {
          userId, valueUsdc: Number(value) / 1_000_000,
          tokenIds: mintResult.tokenIds, mintTxHash: mintResult.txHash,
          permitTxHash, error: lastErr,
        });
        if (isFirestoreConfigured()) {
          try {
            await getAdminFirestore().collection(HOUSE_EATEN_COLLECTION).add({
              userId,
              valueUsdc: Number(value) / 1_000_000,
              tokenIds: mintResult.tokenIds,
              mintTxHash: mintResult.txHash,
              permitTxHash,
              error: lastErr,
              createdAt: FieldValue.serverTimestamp(),
              resolved: false,
            });
          } catch (recordErr) {
            logger.error('instant-mint.house_ate_record_failed', { userId, err: (recordErr as Error).message });
          }
        }
        // No pass_purchased event → revenue stays truthful. Activity shows a
        // grant-style event so the pass's origin is still traceable in admin.
        await logActivityEvent({
          type: 'pass_granted',
          userId,
          walletAddress: userId,
          paymentMethod: 'free',
          quantity: 1,
          tokenIds: mintResult.tokenIds,
          txHash: mintResult.txHash,
          metadata: { source: 'instant_seat_house_ate', collectError: lastErr },
        }).catch(() => {});
      }
    })().finally(() => releaseAdminLock()));

    return json({
      success: true,
      txHashes: { mint: mintResult.txHash },
      tokenIds: mintResult.tokenIds,
      draftPasses: newDraftPasses,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('instant-mint.route_failed', { err: (err as Error).message });
    return jsonError('Entry failed — please try again. You were NOT charged.', 500);
  }
}
