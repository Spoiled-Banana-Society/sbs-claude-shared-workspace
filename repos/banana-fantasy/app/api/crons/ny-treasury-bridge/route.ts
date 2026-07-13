import type { Address } from 'viem';
import { json, jsonError } from '@/lib/api/routeUtils';
import { isAdminMintConfigured } from '@/lib/onchain/adminMint';
import { getRelayerOptimismUsdcBalance, bridgeRelayerUsdcOpToBase } from '@/lib/onchain/nyBridge';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
// A CCTP bridge (approve + burn on Optimism → attestation → receiveMessage on
// Base) runs to completion inside the request; allow room for the attestation.
export const maxDuration = 300;

/**
 * GET /api/crons/ny-treasury-bridge — batched NY revenue sweep.
 *
 * NY buyers pay in USDC on OPTIMISM; the ny-mint route sweeps each payment into
 * the relayer wallet on Optimism and delivers the pass immediately (no
 * per-purchase bridge). This cron periodically moves ALL of that accumulated
 * relayer USDC from Optimism to the Base COLD TREASURY via Circle CCTP — the
 * SAME verified destination normal card revenue reaches (COLD_TREASURY_ADDRESS,
 * default 0xB726598Da099D31014222f2f60A944715D8a9327, Richard's treasury).
 *
 * Why batched instead of per-purchase: no shared-wallet nonce race with mints,
 * cheaper gas, less hot-wallet exposure. The USDC is safe in our own relayer
 * between runs; a failed bridge just leaves it there for the next run (nothing
 * lost). The bridge's mintRecipient is ALWAYS the cold treasury — there is no
 * path to any other address.
 *
 * Auth: Vercel Cron's `Authorization: Bearer ${CRON_SECRET}`.
 */

// Withdrawal destination — mirrors lib/onchain/skimBbb4Usdc.ts resolveTreasury()
// so NY revenue lands in the EXACT same place as normal card revenue.
const COLD_TREASURY_DEFAULT = '0xB726598Da099D31014222f2f60A944715D8a9327';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
// Don't bridge dust — the CCTP fee + gas isn't worth it under a few dollars.
// Below this the USDC just waits for the next run.
const MIN_BRIDGE_USDC = 3_000_000n; // 3 USDC (6-dec)

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

function resolveTreasury(): Address {
  const raw = (process.env.COLD_TREASURY_ADDRESS ?? COLD_TREASURY_DEFAULT).trim() || COLD_TREASURY_DEFAULT;
  if (!WALLET_REGEX.test(raw)) throw new Error('Invalid COLD_TREASURY_ADDRESS');
  return raw.toLowerCase() as Address;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  runInBackground('cron.heartbeat', recordCronHeartbeat('ny-treasury-bridge'));

  if (!isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

  let treasury: Address;
  try {
    treasury = resolveTreasury();
  } catch (e) {
    logger.error('ny-treasury-bridge.bad_treasury', { err: (e as Error).message });
    return jsonError('Invalid treasury config', 503);
  }

  const balance = await getRelayerOptimismUsdcBalance();
  if (balance < MIN_BRIDGE_USDC) {
    logger.info('ny-treasury-bridge.skip', { balance: balance.toString(), min: MIN_BRIDGE_USDC.toString() });
    return json({ ok: true, bridged: '0', balance: balance.toString(), treasury, note: 'below threshold' });
  }

  logger.info('ny-treasury-bridge.start', { balance: balance.toString(), treasury });
  const res = await bridgeRelayerUsdcOpToBase(balance, treasury);
  if (!res.ok) {
    logger.error('ny-treasury-bridge.failed', { balance: balance.toString(), treasury, err: res.error });
    // Non-fatal: the USDC is still in the relayer on Optimism, retried next run.
    return jsonError(`Bridge failed (funds safe on Optimism, retried next run): ${res.error ?? 'unknown'}`, 500);
  }

  logger.info('ny-treasury-bridge.ok', { bridged: balance.toString(), treasury, burnTx: res.burnTxHash, mintTx: res.mintTxHash });
  return json({ ok: true, bridged: balance.toString(), treasury, txHashes: { burn: res.burnTxHash, mint: res.mintTxHash } });
}
