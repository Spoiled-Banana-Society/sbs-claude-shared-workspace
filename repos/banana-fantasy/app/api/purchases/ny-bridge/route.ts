export const dynamic = 'force-dynamic';

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isNyBuyer, isNyOnrampEnabled } from '@/lib/usState';
import { getRequestGeo } from '@/lib/geoLocation';
import { sweepUsdcFromUserOnOptimism, bridgeRelayerUsdcOpToBase } from '@/lib/onchain/nyBridge';
import { BASE_MAINNET_RPC_URL } from '@/lib/onchain/cctp';
import { BBB4_ABI, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { logger } from '@/lib/logger';

/**
 * POST /api/purchases/ny-bridge
 *
 * The NY-only pre-step before the normal Base mint. A New York buyer bought USDC
 * on OPTIMISM (MoonPay blocks Base for NY). This route:
 *   1. sweeps their Optimism USDC into the relayer (their signed OP permit),
 *   2. CCTP-bridges it to Base, minting it to the buyer's OWN Base wallet,
 * after which the client runs the EXISTING mint() flow unchanged (card-mint,
 * bookkeeping, promos — all reused, untouched).
 *
 * Hard-gated: does NOTHING unless the caller is a NY buyer AND NY_ONRAMP_ENABLED
 * is on. Any non-NY caller (or the flag off) gets 403 and never touches money.
 *
 * Recoverable by design: a failed sweep leaves USDC in the buyer's own wallet; a
 * failed bridge leaves it in our relayer (both recoverable, never lost).
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

    // Inputs. `signature` is the OP-domain USDC permit (spender = relayer).
    const body = await parseBody(req);
    const quantity = Number(body.quantity);
    const deadline = BigInt(Number(body.deadline) || 0);
    const signature = (typeof body.signature === 'string' ? body.signature : '0x') as Hex;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
      return jsonError('Invalid quantity', 400);
    }

    // Server computes the amount from the on-chain price × qty — the client can't
    // under/over-state it (the OP permit the user signed is for this same value).
    const basePub = createPublicClient({ chain: base, transport: http(BASE_MAINNET_RPC_URL) });
    const price = (await basePub.readContract({ address: BBB4_CONTRACT_ADDRESS, abi: BBB4_ABI, functionName: 'TOKEN_PRICE_USDC' })) as bigint;
    const value = price * BigInt(quantity);

    // 1. Sweep the buyer's OP USDC into the relayer.
    const sweep = await sweepUsdcFromUserOnOptimism({ user, value, deadline, signature });
    if (!sweep.ok) {
      logger.warn('ny-bridge.sweep_failed', { user, value: value.toString(), err: sweep.error });
      // Nothing moved (or it's still in the buyer's wallet) — safe to just retry.
      return jsonError(`Could not collect payment on Optimism: ${sweep.error ?? 'unknown'}`, 402);
    }

    // 2. Bridge relayer USDC → buyer's OWN Base wallet.
    const bridge = await bridgeRelayerUsdcOpToBase(value, user);
    if (!bridge.ok) {
      // Payment collected but not yet on Base — the USDC is safe in our relayer,
      // recoverable (retry the bridge / manual). Tell the client it's pending so
      // it shows a reassuring "processing" state, never a scary failure.
      logger.error('ny-bridge.bridge_failed_after_sweep', { user, value: value.toString(), sweepTx: sweep.txHash, err: bridge.error });
      return jsonError('Payment received — finalizing. Your draft pass is on its way; you will not be charged again.', 500, { paymentSucceeded: true });
    }

    logger.info('ny-bridge.ok', { user, quantity, value: value.toString(), sweepTx: sweep.txHash, burnTx: bridge.burnTxHash, mintTx: bridge.mintTxHash });
    // USDC is now on the buyer's Base wallet → client runs the existing mint().
    return json({ success: true, onBase: true, value: value.toString(), txHashes: { sweep: sweep.txHash, bridgeBurn: bridge.burnTxHash, bridgeMint: bridge.mintTxHash } });
  } catch (err) {
    logger.error('ny-bridge.unhandled', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Internal Server Error', 500);
  }
}
