// Shared BBB4 USDC withdrawal ("skim") logic — ONE code path used by both the
// (currently manual) cron route and the admin-panel "Withdraw to treasury"
// button. Pulls accumulated mint USDC out of the BBB4 contract and forwards it
// to the cold treasury, holding back any USDC owed to pending gasless-buy
// refunds. The owner key signs SERVER-SIDE via viem — it is never imported into
// a wallet, so the EIP-7702 delegation risk that broke minting (Apr 2026) does
// not apply here.

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
import { logger } from '@/lib/logger';

const COLD_TREASURY_DEFAULT = '0xC0F982492c323Fcd314af56d6c1A35Cc9b0fC31E';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

/** Thrown when env isn't configured (missing key / bad treasury). Carries an
 *  HTTP status so route handlers can map it to 503 cleanly. */
export class SkimConfigError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'SkimConfigError';
    this.status = status;
  }
}

export interface SkimResult {
  opsWallet: string;
  treasury: string;
  contractUsdcBefore: string;
  opsUsdcBefore: string;
  withdrawTxHash: Hex | null;
  transferTxHash: Hex | null;
  transferredToTreasury: string;
  owedReserve: string;
  note: string;
}

export interface TreasurySnapshot {
  opsWallet: string;
  treasury: string;
  contractUsdc: string;
  opsUsdc: string;
  treasuryUsdc: string;
  owedReserve: string;
}

function loadPrivateKey(): Hex {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) throw new SkimConfigError('BBB4_OWNER_PRIVATE_KEY not configured');
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new SkimConfigError('BBB4_OWNER_PRIVATE_KEY is malformed');
  return hex as Hex;
}

function resolveTreasury(): Address {
  const raw = (process.env.COLD_TREASURY_ADDRESS ?? COLD_TREASURY_DEFAULT).trim() || COLD_TREASURY_DEFAULT;
  if (!WALLET_REGEX.test(raw)) throw new SkimConfigError('Invalid COLD_TREASURY_ADDRESS');
  return raw.toLowerCase() as Address;
}

/** Sum the USDC owed to in-flight gasless buys that hasn't been delivered yet —
 *  reconcile-relay-buys refunds these FROM the ops wallet, so we must NOT sweep
 *  it to cold storage. Fails SAFE: on any read error, treat the whole ops
 *  balance as owed so a run can't accidentally sweep a customer's refund. */
async function computeOwedReserve(fallbackOnError: bigint): Promise<bigint> {
  if (!isFirestoreConfigured()) return 0n;
  try {
    const db = getAdminFirestore();
    const [legacy, pending] = await Promise.all([
      db.collection('failed_marketplace_relays').where('resolved', '==', false).get(),
      db.collection('relay_buys').where('status', 'in', ['pulled', 'reconciling', 'needs_manual']).get(),
    ]);
    let owed = 0n;
    for (const doc of [...legacy.docs, ...pending.docs]) {
      try { owed += BigInt(doc.data().priceUsdc ?? '0'); } catch { /* skip bad row */ }
    }
    return owed;
  } catch (err) {
    logger.warn('skim.reserve_calc_failed', { err: (err as Error).message });
    return fallbackOnError;
  }
}

/** Read-only: current balances + the refund reserve, for display/preview.
 *  No transactions. Throws SkimConfigError if env isn't set. */
export async function readBbb4Treasury(): Promise<TreasurySnapshot> {
  const key = loadPrivateKey();
  const treasury = resolveTreasury();
  const opsWallet = privateKeyToAccount(key).address as Address;
  const pub = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

  const balOf = (who: Address) => pub.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [who],
  }) as Promise<bigint>;

  const [contractUsdc, opsUsdc, treasuryUsdc] = await Promise.all([
    balOf(BBB4_CONTRACT_ADDRESS), balOf(opsWallet), balOf(treasury),
  ]);
  const owedReserve = await computeOwedReserve(opsUsdc);

  return {
    opsWallet,
    treasury,
    contractUsdc: contractUsdc.toString(),
    opsUsdc: opsUsdc.toString(),
    treasuryUsdc: treasuryUsdc.toString(),
    owedReserve: owedReserve.toString(),
  };
}

/**
 * Withdraw the contract's USDC → ops wallet → cold treasury (minus the owed
 * refund reserve), and write an audit row to `bbb4_usdc_sweeps`. Idempotent in
 * spirit: a no-balance run is a harmless no-op. Throws SkimConfigError if env
 * isn't set; surfaces on-chain failures in `result.note` rather than throwing
 * (so a partial run is still recorded + returned).
 */
export async function skimBbb4Usdc(opts: { source?: string } = {}): Promise<SkimResult> {
  const key = loadPrivateKey();
  const treasury = resolveTreasury();

  const account = privateKeyToAccount(key);
  const opsWallet = account.address as Address;
  const wallet = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });
  const pub = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

  const usdcBalance = (who: Address) => pub.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [who],
  }) as Promise<bigint>;

  const contractBalanceBefore = await usdcBalance(BBB4_CONTRACT_ADDRESS);
  const opsUsdcBefore = await usdcBalance(opsWallet);

  const result: SkimResult = {
    opsWallet,
    treasury,
    contractUsdcBefore: contractBalanceBefore.toString(),
    opsUsdcBefore: opsUsdcBefore.toString(),
    withdrawTxHash: null,
    transferTxHash: null,
    transferredToTreasury: '0',
    owedReserve: '0',
    note: '',
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

  // 2. Transfer ops wallet's USDC (including any previously stuck) → treasury,
  //    minus the buyer-refund reserve we must keep in the ops wallet.
  const opsUsdcAfterWithdraw = await usdcBalance(opsWallet);
  const owedReserve = await computeOwedReserve(opsUsdcAfterWithdraw);
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

  // 3. Record the sweep for the audit trail.
  if (isFirestoreConfigured()) {
    try {
      await getAdminFirestore().collection('bbb4_usdc_sweeps').add({
        ...result,
        source: opts.source ?? 'unknown',
        runAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn('skim.audit_write_failed', { err: (err as Error).message });
    }
  }

  logger.info('skim.completed', { ...result, source: opts.source ?? 'unknown' });
  return result;
}
