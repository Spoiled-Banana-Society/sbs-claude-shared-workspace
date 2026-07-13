// Jackpot draw VRF derivation + instant on-chain receipt (Boris 2026-06-11).
//
// The draw can't be predetermined like wheel spins (the outcome depends on
// which PAID wallets are in the draft, known only at fill), so it late-binds
// the wheel period's PRE-COMMITTED randomness to the paid list:
//
//   winnerIdx = sha256(periodSalt + vrfRandomness + 'jp-draw:' + draftId)
//               → uint32 % paidCount
//
//  • Unpredictable beforehand: the salt is sealed (only its hash is on-chain),
//    so nobody — including a last-joiner with several wallets — can compute
//    the winner before the draft fills.
//  • Un-grindable by SBS: salt hash + VRF randomness were locked on-chain
//    before this draft existed.
//  • Fully auditable at period reveal: once the salt is published anyone can
//    recompute every draw and match it against the instant receipts below.
//
// INSTANT RECEIPT: the moment the draw runs we post a self-send tx on Base
// whose calldata is the full canonical draw record (draft, paid wallets in
// slot order, winner, period + salt hash). Permanent within seconds, sub-cent,
// no contract deploy needed. When the assignment-journal contract goes live
// draws can graduate to Merkle-batched commits there.

import crypto from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseGwei, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getCurrentPeriodNumber, type WheelPeriodDoc } from '@/lib/wheelPeriod';
import { logger } from '@/lib/logger';

export interface SealedDrawSeed {
  periodNumber: number;
  /** SECRET until period reveal — never write into any public record. */
  salt: string;
  vrfRandomness: string;
  /** Public commitment (already on-chain from period open). */
  saltHash: string;
}

/**
 * The active wheel period's sealed seed material. Null when no period is
 * active (callers fall back to the legacy draftId-only basis so a draw can
 * never be blocked on period state).
 */
export async function getSealedDrawSeed(): Promise<SealedDrawSeed | null> {
  try {
    const periodNumber = await getCurrentPeriodNumber();
    if (periodNumber === null) return null;
    const db = getAdminFirestore();
    const snap = await db.collection('wheel_periods').doc(String(periodNumber)).get();
    if (!snap.exists) return null;
    const p = snap.data() as WheelPeriodDoc;
    if (p.status !== 'active' || !p.salt || !p.vrfRandomness || !p.saltHash) return null;
    return { periodNumber, salt: p.salt, vrfRandomness: p.vrfRandomness, saltHash: p.saltHash };
  } catch {
    return null;
  }
}

const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);

/** Deterministic winner index from the sealed period seed + this draft. */
export function deriveDrawWinnerIdx(seed: SealedDrawSeed, draftId: string, paidCount: number): number {
  const hash = crypto
    .createHash('sha256')
    .update(strip0x(seed.salt) + strip0x(seed.vrfRandomness) + `jp-draw:${draftId}`)
    .digest();
  return hash.readUInt32BE(0) % paidCount;
}

/** Public, salt-free description of how this draw was derived. */
export function sealedSeedBasis(seed: SealedDrawSeed): string {
  return (
    `sha256(period ${seed.periodNumber} sealed salt + VRF randomness + "jp-draw:" + draftId) → uint32 % paidCount, ` +
    `paid entrants in slot order. Salt hash ${seed.saltHash} was committed on-chain before this draft existed; ` +
    `the salt publishes at period reveal, making every draw independently recomputable.`
  );
}

export interface DrawReceiptInput {
  draftId: string;
  displayName: string;
  periodNumber: number | null;
  saltHash: string | null;
  paid: string[]; // slot order
  winnerWallet: string | null;
  winnerIdx: number | null;
  reward: number;
  atIso: string;
}

/** Canonical JSON the receipt commits to — field order is fixed. */
export function canonicalDrawRecord(r: DrawReceiptInput): string {
  return JSON.stringify({
    v: 1,
    kind: 'sbs-jackpot-draw',
    draftId: r.draftId,
    displayName: r.displayName,
    period: r.periodNumber,
    saltHash: r.saltHash,
    paid: r.paid,
    winner: r.winnerWallet,
    winnerIdx: r.winnerIdx,
    reward: r.reward,
    at: r.atIso,
  });
}

/**
 * Post the instant on-chain receipt: a self-send tx whose calldata is the
 * canonical draw record. Returns the tx hash, or null on failure — a failed
 * receipt NEVER blocks the draw (ensureDrawReceipt retries from the close
 * backstop).
 */
export async function postDrawReceiptOnchain(record: DrawReceiptInput): Promise<Hex | null> {
  try {
    const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
    if (!raw) return null;
    const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
    const account = privateKeyToAccount(key);
    const pub = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
    const wallet = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });

    // Adapt to the live base fee — fixed 0.1 gwei stalls when Base spikes.
    const block = await pub.getBlock();
    const baseFee = block.baseFeePerGas ?? parseGwei('0.05');
    const maxFeePerGas = baseFee * 2n > parseGwei('0.1') ? baseFee * 2n : parseGwei('0.1');

    const txHash = await wallet.sendTransaction({
      to: account.address,
      value: 0n,
      data: stringToHex(`SBSJPDRAW1:${canonicalDrawRecord(record)}`),
      maxFeePerGas,
      maxPriorityFeePerGas: parseGwei('0.001'),
    });
    await pub.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    return txHash;
  } catch (err) {
    logger.error('promo.jackpot_draw.receipt_failed', {
      err: err instanceof Error ? err : String(err),
      context: { draftId: record.draftId },
    });
    return null;
  }
}

/**
 * Backstop: if a draw exists but its receipt tx never landed (RPC blip at
 * draw time), post it now. Safe to call repeatedly — no-ops once posted.
 */
export async function ensureDrawReceipt(draftId: string): Promise<void> {
  const db = getAdminFirestore();
  const ref = db.collection('jackpot_draws').doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data() ?? {};
  if (d.pending || d.noOrder || d.receiptTxHash) return;
  const record: DrawReceiptInput = {
    draftId,
    displayName: (d.displayName as string) ?? draftId,
    periodNumber: (d.vrfPeriod as number) ?? null,
    saltHash: (d.saltHash as string) ?? null,
    paid: ((d.eligible as { wallet: string }[]) ?? []).map((e) => e.wallet),
    winnerWallet: (d.winnerWallet as string) ?? null,
    winnerIdx: (d.winnerIdx as number) ?? null,
    reward: Number(d.reward ?? 0),
    atIso: (d.atIso as string) ?? '',
  };
  const txHash = await postDrawReceiptOnchain(record);
  if (txHash) await ref.set({ receiptTxHash: txHash }, { merge: true });
}
