export const dynamic = 'force-dynamic';
// The Optimism→Base treasury bridge runs in the background (runInBackground /
// waitUntil) AFTER we respond, so allow the lambda to stay alive for it. The
// buyer's response returns in ~30s (sweep + mint + bookkeep); the bridge (~60-90s)
// finishes after, invisible to them.
export const maxDuration = 300;

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { FieldValue } from 'firebase-admin/firestore';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isNyBuyer, isNyOnrampEnabled } from '@/lib/usState';
import { getRequestGeo } from '@/lib/geoLocation';
import { sweepUsdcFromUserOnOptimism, bridgeRelayerUsdcOpToBase } from '@/lib/onchain/nyBridge';
import { BASE_MAINNET_RPC_URL } from '@/lib/onchain/cctp';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { BBB4_ABI, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { bookkeepPaidMint } from '@/lib/purchases/bookkeepPaidMint';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';

const FAILED_MINTS_COLLECTION = 'failed_mints';

/**
 * POST /api/purchases/ny-mint  — the FAST New York path.
 *
 * A NY buyer bought USDC on OPTIMISM (MoonPay blocks Base for NY). This route:
 *   1. sweeps their Optimism USDC into the relayer (their signed OP permit) —
 *      payment is now SECURED (it's our USDC),
 *   2. immediately owner-mints the paid pass to them + runs the IDENTICAL paid
 *      bookkeeping card buyers get (paid status, card-fee credit, promos) via
 *      bookkeepPaidMint, so the pass is in hand in ~30s — no bridge wait,
 *   3. bridges the relayer's Optimism USDC to Base treasury in the BACKGROUND
 *      (runInBackground/waitUntil) — pure housekeeping the buyer never sees.
 *
 * Payment and delivery are decoupled: we collected the money on Optimism (step 1),
 * so we can deliver the NFT via owner-mint without the USDC being on Base yet. The
 * bridge (step 3) just relocates money WE already own.
 *
 * card-mint is NOT touched — the Base flow every other buyer uses is unchanged.
 * Hard-gated: does NOTHING unless the caller is a NY buyer AND NY_ONRAMP_ENABLED
 * is on. Recoverable by design: a failed sweep leaves USDC in the buyer's wallet;
 * a failed owner-mint after sweep is queued to the fulfill-failed-mints cron; a
 * failed background bridge just leaves our own USDC on Optimism (safe, retryable).
 */
export async function POST(req: Request) {
  try {
    if (!isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

    // Auth.
    let user: Address;
    try {
      const u = await getPrivyUser(req);
      if (!u.walletAddress) return jsonError('No wallet', 401);
      user = u.walletAddress.toLowerCase() as Address;
    } catch {
      return jsonError('Unauthorized', 401);
    }

    // Hard gate: NY buyer + flag on, else refuse (this route only exists for NY).
    if (!isNyOnrampEnabled()) return jsonError('NY on-ramp disabled', 403);
    if (!isFirestoreConfigured()) return jsonError('Not configured', 503);
    const data = (await getAdminFirestore().collection('v2_users').doc(user).get()).data() ?? {};
    const geo = getRequestGeo(req);
    const nySource = {
      usState: (data.usState as string) ?? null,
      ipCountry: (data.ipCountry as string) ?? geo.country,
      ipRegion: (data.ipRegion as string) ?? geo.region,
    };
    if (!isNyBuyer(nySource)) return jsonError('Not a NY buyer', 403);

    // Inputs. `signature` is the OP-domain USDC permit (spender = relayer);
    // `permitValue` is what it authorizes = the buyer's whole OP balance at sign
    // time. We sweep their actual balance capped at that.
    const body = await parseBody(req);
    const quantity = Number(body.quantity);
    const deadlineNum = Number(body.deadline) || 0;
    const deadline = BigInt(deadlineNum);
    const permitValue = BigInt((typeof body.permitValue === 'string' ? body.permitValue : '0') || 0);
    const signature = (typeof body.signature === 'string' ? body.signature : '0x') as Hex;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
      return jsonError('Invalid quantity', 400);
    }

    // Pass cost (on-chain price × qty) — the FLOOR the swept amount must clear.
    const basePub = createPublicClient({ chain: base, transport: http(BASE_MAINNET_RPC_URL) });
    const price = (await basePub.readContract({ address: BBB4_CONTRACT_ADDRESS, abi: BBB4_ABI, functionName: 'TOKEN_PRICE_USDC' })) as bigint;
    const passCost = price * BigInt(quantity);
    if (permitValue < passCost) return jsonError('Permit below pass cost', 400);

    // 1. Sweep the buyer's OP USDC into the relayer — payment SECURED.
    const sweep = await sweepUsdcFromUserOnOptimism({ user, permitValue, deadline, signature });
    if (!sweep.ok || sweep.sweptValue == null) {
      logger.warn('ny-mint.sweep_failed', { user, permitValue: permitValue.toString(), err: sweep.error });
      return jsonError(`Could not collect payment on Optimism: ${sweep.error ?? 'unknown'}`, 402);
    }
    const swept = sweep.sweptValue;
    if (swept < passCost) {
      // Swept less than the pass costs — can't cover it. USDC is safe in relayer;
      // bridge it back to the buyer so nothing's stuck, and ask them to retry.
      logger.error('ny-mint.swept_below_cost', { user, swept: swept.toString(), passCost: passCost.toString() });
      runInBackground('ny-mint.refund-bridge', bridgeRelayerUsdcOpToBase(swept, user).then(() => undefined));
      return jsonError('Payment received but a bit short — your USDC is on its way to your wallet; please try the purchase again.', 402, { paymentSucceeded: true });
    }

    // 2. Owner-mint the paid pass to the buyer (payment already collected on OP).
    //    Serialize on the shared admin wallet like card-mint does.
    const releaseAdminLock = await acquireAdminWalletLock('ny-mint');
    let mintResult: { txHash: Hex; tokenIds: string[] } | undefined;
    try {
      mintResult = await reserveTokensToWallet({ to: user, count: quantity });
    } catch (err) {
      logger.error('ny-mint.mint_failed_after_payment', { user, quantity, swept: swept.toString(), err: (err as Error).message });
      // Payment collected but mint failed → queue it; the fulfill-failed-mints
      // cron delivers within minutes. Still bridge the money to treasury.
      try {
        await getAdminFirestore().collection(FAILED_MINTS_COLLECTION).add({
          source: 'ny-mint', userId: user, quantity, value: passCost.toString(),
          paymentMethod: 'card', sweepTxHash: sweep.txHash, error: (err as Error).message,
          createdAt: FieldValue.serverTimestamp(), retryable: true, resolved: false, attempts: 0,
        });
      } catch (logErr) {
        logger.error('ny-mint.failed_mint_record_error', { user, err: logErr });
      }
      runInBackground('ny-mint.treasury-bridge', bridgeRelayerUsdcOpToBase(swept).then(() => undefined));
      return jsonError(
        'Your payment went through and your draft pass is on its way — it has been queued and will be delivered automatically, usually within a few minutes. You will NOT be charged again.',
        500, { paymentSucceeded: true },
      );
    } finally {
      await releaseAdminLock();
    }

    // 3. IDENTICAL paid bookkeeping card buyers get — paid status, card-fee
    //    credit, promos, recount, activity, bell. (Same code, NY-only copy.)
    const bookkeeping = await bookkeepPaidMint({
      userId: user,
      quantity,
      paymentMethod: 'card',
      cardProvider: 'moonpay',
      value: passCost,
      deadlineNum,
      permitTxHash: 'ny-optimism-sweep',
      transferTxHash: sweep.txHash,
      mintResult,
    });

    // 4. Bridge the relayer's Optimism USDC → Base treasury in the BACKGROUND.
    //    The buyer already has their pass; this just relocates our own money.
    //    waitUntil-backed so it survives the response; if it ever fails the USDC
    //    is safe in the relayer on Optimism (retryable / batch-sweepable).
    runInBackground('ny-mint.treasury-bridge', bridgeRelayerUsdcOpToBase(swept).then((r) => {
      if (!r.ok) logger.error('ny-mint.treasury_bridge_failed', { user, swept: swept.toString(), err: r.error });
    }));

    logger.info('ny-mint.ok', { user, quantity, swept: swept.toString(), passCost: passCost.toString(), sweepTx: sweep.txHash, mintTx: mintResult.txHash });
    return json({
      success: true,
      minted: quantity,
      tokenIds: mintResult.tokenIds,
      draftPasses: bookkeeping.draftPasses,
      promoAwards: bookkeeping.promoAwards,
      cardFreeDraftsEarned: bookkeeping.cardFreeDraftsEarned,
      txHashes: { sweep: sweep.txHash, mint: mintResult.txHash },
    });
  } catch (err) {
    logger.error('ny-mint.unhandled', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Internal Server Error', 500);
  }
}
