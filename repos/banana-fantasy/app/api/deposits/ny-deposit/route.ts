export const dynamic = 'force-dynamic';
// The response returns after sweep + CCTP bridge (~60-90s incl. Circle
// attestation). Generous ceiling so a slow attestation never kills the bridge
// mid-flight.
export const maxDuration = 300;

import type { Address, Hex } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isNyBuyer, isNyOnrampEnabled } from '@/lib/usState';
import { getRequestGeo } from '@/lib/geoLocation';
import { sweepUsdcFromUserOnOptimism, bridgeRelayerUsdcOpToBase } from '@/lib/onchain/nyBridge';
import { logger } from '@/lib/logger';

// Bridge-stuck incidents land here (NOT failed_mints — that collection feeds the
// fulfill-failed-mints cron, which would wrongly mint PASSES for what is a
// deposit). A record here = user's swept USDC is sitting safely in the relayer
// on the source chain awaiting a manual/retried bridge to their Base wallet.
const NY_DEPOSIT_INCIDENTS_COLLECTION = 'ny_deposit_incidents';

/**
 * POST /api/deposits/ny-deposit — the New York ADD FUNDS path.
 *
 * A NY depositor bought USDC on the NY source chain (Optimism — MoonPay blocks
 * Base AND Arbitrum for NY). Deposits must end as USDC in the user's OWN Base
 * wallet (the deposit model deliberately stops at "money in your wallet" — no
 * mint, no charge), so unlike ny-mint this route:
 *   1. sweeps the depositor's source-chain USDC into the relayer (their signed
 *      permit — same gasless mechanism as ny-mint),
 *   2. CCTP-bridges ALL of it with mintRecipient = the DEPOSITOR's own wallet,
 *      so the USDC arrives natively in their Base wallet. The client's existing
 *      Base waitForUsdcArrival sees it land and the normal deposit tail runs
 *      (balance refresh, card-fee credit, onFunded) untouched.
 *
 * Every cent swept goes to the user — there is no cost floor to enforce and no
 * revenue kept here, which is why this is safe to sweep-all: under-delivery by
 * MoonPay just means the user receives exactly what arrived. Recoverable by
 * design: a failed sweep leaves USDC in the user's own source-chain wallet; a
 * failed bridge leaves it in OUR relayer with an incident record (never burned,
 * never to a third address — recipient is only ever the authed user).
 *
 * Hard-gated exactly like ny-mint: NY buyer + NY_ONRAMP_ENABLED, else 403.
 */
export async function POST(req: Request) {
  try {
    // Auth.
    let user: Address;
    try {
      const u = await getPrivyUser(req);
      if (!u.walletAddress) return jsonError('No wallet', 401);
      user = u.walletAddress.toLowerCase() as Address;
    } catch {
      return jsonError('Unauthorized', 401);
    }

    // Hard gate: NY buyer + flag on (this route only exists for NY).
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

    // Inputs — the source-chain USDC permit (spender = relayer) for the user's
    // whole balance at sign time. We sweep their actual balance capped at it.
    const body = await parseBody(req);
    const deadlineNum = Number(body.deadline) || 0;
    const deadline = BigInt(deadlineNum);
    const permitValue = BigInt((typeof body.permitValue === 'string' ? body.permitValue : '0') || 0);
    const signature = (typeof body.signature === 'string' ? body.signature : '0x') as Hex;
    // Floor: don't run a bridge for dust (also blocks a zero-value permit call).
    if (permitValue < 1_000_000n) return jsonError('Deposit too small', 400);

    // 1. Sweep the depositor's source-chain USDC into the relayer.
    const sweep = await sweepUsdcFromUserOnOptimism({ user, permitValue, deadline, signature });
    if (!sweep.ok || sweep.sweptValue == null) {
      logger.warn('ny-deposit.sweep_failed', { user, permitValue: permitValue.toString(), err: sweep.error });
      return jsonError(`Could not collect the deposit: ${sweep.error ?? 'unknown'}`, 402);
    }
    const swept = sweep.sweptValue;

    // 2. Bridge ALL of it to the DEPOSITOR's own Base wallet. One retry on
    //    failure — safe: if the first burn actually went through, the relayer
    //    balance sanity check inside the bridge fails the retry (no double-burn).
    let bridge = await bridgeRelayerUsdcOpToBase(swept, user);
    if (!bridge.ok) {
      logger.warn('ny-deposit.bridge_retry', { user, swept: swept.toString(), err: bridge.error });
      bridge = await bridgeRelayerUsdcOpToBase(swept, user);
    }
    if (!bridge.ok) {
      // Money is SAFE in our relayer on the source chain. Record the incident
      // for recovery and reassure — the user is never out their deposit.
      logger.error('ny-deposit.bridge_failed', { user, swept: swept.toString(), sweepTx: sweep.txHash, err: bridge.error });
      try {
        await getAdminFirestore().collection(NY_DEPOSIT_INCIDENTS_COLLECTION).add({
          userId: user, sweptValue: swept.toString(), sweepTxHash: sweep.txHash,
          burnTxHash: bridge.burnTxHash ?? null, error: bridge.error ?? 'unknown',
          createdAt: FieldValue.serverTimestamp(), resolved: false,
        });
      } catch (recErr) {
        logger.error('ny-deposit.incident_record_error', { user, err: recErr });
      }
      return jsonError(
        'Your payment went through and your balance is on its way — it is being finalized and will land automatically. You will NOT be charged again.',
        500, { paymentSucceeded: true },
      );
    }

    logger.info('ny-deposit.ok', { user, swept: swept.toString(), sweepTx: sweep.txHash, burnTx: bridge.burnTxHash, mintTx: bridge.mintTxHash });
    return json({ success: true, sweptValue: swept.toString(), txHashes: { sweep: sweep.txHash, burn: bridge.burnTxHash, mint: bridge.mintTxHash } });
  } catch (err) {
    logger.error('ny-deposit.unhandled', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Internal Server Error', 500);
  }
}
