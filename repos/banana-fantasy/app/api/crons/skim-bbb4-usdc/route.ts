import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { FieldValue } from 'firebase-admin/firestore';

import {
  BASE,
  BASE_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BBB4_ABI,
  BBB4_CONTRACT_ADDRESS,
  USDC_ABI,
} from '@/lib/contracts/bbb4';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Hourly Vercel cron job that sweeps accumulated USDC out of the BBB4
 * contract and forwards it to a cold treasury wallet Richard controls.
 *
 * Flow (per run):
 *   1. Alchemy RPC read: BBB4 contract's USDC balance.
 *   2. If balance > 0, call BBB4.withdraw() — USDC → ops wallet (contract owner).
 *   3. Read ops wallet's USDC balance.
 *   4. Transfer ops wallet's USDC → cold treasury.
 *   5. Record the sweep in Firestore `bbb4_usdc_sweeps` for audit trail.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; we reject
 * anything else so the endpoint can't be hit by random internet callers.
 *
 * Env:
 *   - CRON_SECRET: long random string, matches vercel.json cron config.
 *   - BBB4_OWNER_PRIVATE_KEY: same key used by admin mint.
 *   - COLD_TREASURY_ADDRESS: Richard's cold EOA (0xC0F9824...).
 */

const COLD_TREASURY_DEFAULT = '0xC0F982492c323Fcd314af56d6c1A35Cc9b0fC31E';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

function loadPrivateKey(): Hex | null {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as Hex) : null;
}

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed if secret not configured
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  const key = loadPrivateKey();
  if (!key) return jsonError('BBB4_OWNER_PRIVATE_KEY not configured', 503);

  const treasuryRaw = (process.env.COLD_TREASURY_ADDRESS ?? COLD_TREASURY_DEFAULT).trim();
  if (!WALLET_REGEX.test(treasuryRaw)) {
    return jsonError('Invalid COLD_TREASURY_ADDRESS', 503);
  }
  const treasury = treasuryRaw.toLowerCase() as Address;

  const account = privateKeyToAccount(key);
  const opsWallet = account.address as Address;
  const wallet = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });
  const pub = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

  const contractBalanceBefore = (await pub.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [BBB4_CONTRACT_ADDRESS],
  })) as bigint;

  const opsUsdcBefore = (await pub.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [opsWallet],
  })) as bigint;

  const result = {
    opsWallet,
    treasury,
    contractUsdcBefore: contractBalanceBefore.toString(),
    opsUsdcBefore: opsUsdcBefore.toString(),
    withdrawTxHash: null as Hex | null,
    transferTxHash: null as Hex | null,
    transferredToTreasury: '0',
    owedReserve: '0',
    note: '' as string,
  };

  // 1. Withdraw from BBB4 → ops wallet, if anything to withdraw.
  if (contractBalanceBefore > 0n) {
    try {
      const hash = await wallet.writeContract({
        address: BBB4_CONTRACT_ADDRESS,
        abi: BBB4_ABI,
        functionName: 'withdrawUSDC',
        args: [],
      });
      result.withdrawTxHash = hash;
      await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (err) {
      logger.error('skim.withdraw_failed', { err: (err as Error).message });
      result.note = `withdraw failed: ${(err as Error).message}`;
    }
  } else {
    result.note = 'contract USDC balance is 0 — no-op';
  }

  // 2. Transfer ops wallet's USDC (including any previously stuck) → treasury.
  const opsUsdcAfterWithdraw = (await pub.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [opsWallet],
  })) as bigint;

  // Compute the refund reserve to KEEP in the ops wallet: any gasless relay-buy
  // that pulled a buyer's USDC but hasn't delivered the team yet is owed a
  // refund, and reconcile-relay-buys pays those FROM this wallet. Sweeping them
  // to the cold treasury would starve that refund — money owed to a customer
  // would end up in our treasury with no automated way back. So we leave it.
  let owedReserve = 0n;
  if (isFirestoreConfigured()) {
    try {
      const db = getAdminFirestore();
      const [legacy, pending] = await Promise.all([
        db.collection('failed_marketplace_relays').where('resolved', '==', false).get(),
        db.collection('relay_buys').where('status', 'in', ['pulled', 'reconciling', 'needs_manual']).get(),
      ]);
      for (const doc of [...legacy.docs, ...pending.docs]) {
        try { owedReserve += BigInt(doc.data().priceUsdc ?? '0'); } catch { /* skip bad row */ }
      }
    } catch (err) {
      // Fail SAFE: if we can't tell what's owed, don't sweep anything this run.
      logger.warn('skim.reserve_calc_failed', { err: (err as Error).message });
      owedReserve = opsUsdcAfterWithdraw;
    }
  }
  result.owedReserve = owedReserve.toString();

  const sweepable = opsUsdcAfterWithdraw > owedReserve ? opsUsdcAfterWithdraw - owedReserve : 0n;
  if (sweepable > 0n) {
    try {
      const hash = await wallet.writeContract({
        address: BASE_SEPOLIA_USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [treasury, sweepable],
      });
      result.transferTxHash = hash;
      result.transferredToTreasury = sweepable.toString();
      await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (err) {
      logger.error('skim.transfer_failed', { err: (err as Error).message });
      result.note = `${result.note} / transfer failed: ${(err as Error).message}`.trim();
    }
  } else if (owedReserve > 0n) {
    result.note = `${result.note} / held ${owedReserve} as buyer-refund reserve`.trim();
  }

  // 3. Record the sweep for audit trail.
  if (isFirestoreConfigured()) {
    try {
      const db = getAdminFirestore();
      await db.collection('bbb4_usdc_sweeps').add({
        ...result,
        runAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn('skim.audit_write_failed', { err: (err as Error).message });
    }
  }

  logger.info('skim.completed', result);
  return Response.json({ ok: true, ...result });
}
