import { FieldValue } from 'firebase-admin/firestore';
import { createPublicClient, http, type Address } from 'viem';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import {
  isAdminMintConfigured,
  getAdminWalletAddress,
  transferUsdcFromAdmin,
} from '@/lib/onchain/adminMint';
import { withAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { BASE, BASE_RPC_URL, BBB4_CONTRACT_ADDRESS, BASE_SEPOLIA_USDC_ADDRESS, USDC_ABI } from '@/lib/contracts/bbb4';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { runInBackground } from '@/lib/serverBackground';

export const dynamic = 'force-dynamic';

/**
 * Safety net for the gasless marketplace buy (relay-buy).
 *
 * The buy is non-atomic: it pulls the buyer's USDC into the admin wallet, then
 * fulfills the Seaport order so the team lands in the buyer's wallet. If the
 * server dies/times out between those steps (or the inline refund couldn't
 * run), the buyer's USDC can be left stranded with the team never delivered.
 * This runs every couple minutes and makes the buyer whole — guaranteeing the
 * rule "if your money left, you get the team OR every cent back."
 *
 * It only ever sends money BACK to the wallet it was pulled from, in the exact
 * amount, once, and only after confirming on-chain the buyer didn't get the
 * team. No user input, secret-gated — not a drain vector.
 *
 * Two sources:
 *  1. `relay_buys` rows stuck at status 'pulled' (the crash/timeout case — these
 *     have a durable record written the instant the money was pulled).
 *  2. `failed_marketplace_relays` resolved=false (legacy: pull succeeded but the
 *     inline refund itself failed — confirmed owed).
 */

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_PER_RUN = 10;
const MAX_ATTEMPTS = 8;
const STALE_MS = 3 * 60 * 1000; // give the live flow 3 min before we touch a 'pulled' row
const MAX_REFUND_USDC = 50_000n * 1_000_000n; // sanity ceiling per refund

// Minimal ERC-721 ownerOf fragment (BBB4_ABI doesn't include it).
const ERC721_OWNEROF_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

async function adminUsdcBalance(admin: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [admin],
  })) as bigint;
}

/** Send `amount` USDC back to `buyer` from the admin wallet. Only ever called
 *  with a buyer + amount read from our own records. Holds the admin-wallet lock
 *  so it can't race a live purchase, and refuses if the wallet is short. */
async function refundBuyer(buyer: Address, amount: bigint): Promise<string> {
  if (amount <= 0n || amount > MAX_REFUND_USDC) throw new Error(`refund amount out of range: ${amount}`);
  return withAdminWalletLock('reconcile-relay-buys', async () => {
    const admin = getAdminWalletAddress();
    if (!admin) throw new Error('admin wallet unavailable');
    const bal = await adminUsdcBalance(admin);
    if (bal < amount) throw new Error(`admin USDC ${bal} < owed ${amount}`);
    return transferUsdcFromAdmin({ to: buyer, amount });
  });
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (!isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

  runInBackground('cron.heartbeat', recordCronHeartbeat('reconcile-relay-buys'));

  const db = getAdminFirestore();
  const results: Array<{ id: string; status: string; detail?: string }> = [];
  let processed = 0;

  // ── Source 1: lifecycle rows stuck at 'pulled' (crash/timeout case) ──
  const cutoff = Date.now() - STALE_MS;
  const pulledSnap = await db.collection('relay_buys').where('status', '==', 'pulled').limit(MAX_PER_RUN * 3).get();
  for (const doc of pulledSnap.docs) {
    if (processed >= MAX_PER_RUN) break;
    const d = doc.data();
    const createdMs = typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : 0;
    if (createdMs && createdMs > cutoff) continue; // too fresh — let the live flow finish

    const buyer = String(d.buyerAddress ?? '').toLowerCase();
    const tokenId = String(d.tokenId ?? '');
    let amount: bigint;
    try { amount = BigInt(d.priceUsdc ?? '0'); } catch { amount = 0n; }
    const attempts = Number(d.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) continue;
    if (!WALLET_REGEX.test(buyer) || !tokenId || amount <= 0n) {
      await doc.ref.set({ status: 'invalid', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ id: doc.id, status: 'skipped_invalid' });
      continue;
    }

    // CLAIM transactionally so overlapping runs can't double-refund.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data()?.status !== 'pulled') return false;
      tx.set(doc.ref, { status: 'reconciling', attempts: attempts + 1, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) continue;
    processed++;

    try {
      // On-chain truth: did the team already reach the buyer? (fulfill may have
      // succeeded and only the 'completed' write was lost.) If so, never refund.
      let owner = '';
      try {
        owner = (await publicClient.readContract({
          address: BBB4_CONTRACT_ADDRESS,
          abi: ERC721_OWNEROF_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId)],
        })) as string;
      } catch { owner = ''; }

      if (owner && owner.toLowerCase() === buyer) {
        await doc.ref.set({ status: 'completed', reconciledAt: FieldValue.serverTimestamp(), note: 'buyer already owns token' }, { merge: true });
        results.push({ id: doc.id, status: 'already_delivered' });
        continue;
      }

      const txHash = await refundBuyer(buyer as Address, amount);
      await doc.ref.set({ status: 'refunded', refundTxHash: txHash, reconciledAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.info('reconcile-relay-buys.refunded', { buyer, tokenId, amount: amount.toString(), txHash });
      results.push({ id: doc.id, status: 'refunded', detail: txHash });
    } catch (err) {
      const exhausted = attempts + 1 >= MAX_ATTEMPTS;
      await doc.ref.set(
        { status: exhausted ? 'needs_manual' : 'pulled', lastError: (err as Error).message?.slice(0, 300), lastTriedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      if (exhausted) logger.error('payment.relay_buy.refund_unrecoverable', { buyer, tokenId, amount: amount.toString(), err: (err as Error).message });
      results.push({ id: doc.id, status: exhausted ? 'exhausted_needs_manual' : 'retry_failed' });
    }
  }

  // ── Source 2: legacy failed_marketplace_relays (inline refund failed) ──
  const legacySnap = await db.collection('failed_marketplace_relays').where('resolved', '==', false).limit(MAX_PER_RUN).get();
  for (const doc of legacySnap.docs) {
    if (processed >= MAX_PER_RUN) break;
    const d = doc.data();
    const buyer = String(d.buyerAddress ?? '').toLowerCase();
    let amount: bigint;
    try { amount = BigInt(d.priceUsdc ?? '0'); } catch { amount = 0n; }
    const attempts = Number(d.refundAttempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) continue;
    if (!WALLET_REGEX.test(buyer) || amount <= 0n) {
      await doc.ref.set({ resolved: true, resolvedReason: 'invalid_record', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ id: doc.id, status: 'legacy_skipped_invalid' });
      continue;
    }

    // CLAIM: mark resolved=true up front so a concurrent run skips it; released
    // back to false on failure (same pattern as fulfill-failed-mints).
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data()?.resolved === true) return false;
      tx.set(doc.ref, { resolved: true, refundAttempts: attempts + 1, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) continue;
    processed++;

    try {
      const txHash = await refundBuyer(buyer as Address, amount);
      await doc.ref.set({ resolved: true, refundTxHash: txHash, refundedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.info('reconcile-relay-buys.legacy_refunded', { buyer, amount: amount.toString(), txHash });
      results.push({ id: doc.id, status: 'legacy_refunded', detail: txHash });
    } catch (err) {
      const exhausted = attempts + 1 >= MAX_ATTEMPTS;
      await doc.ref.set(
        { resolved: false, needsManual: exhausted, lastError: (err as Error).message?.slice(0, 300), lastTriedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      if (exhausted) logger.error('payment.relay_buy.refund_unrecoverable', { buyer, amount: amount.toString(), err: (err as Error).message });
      results.push({ id: doc.id, status: exhausted ? 'legacy_exhausted' : 'legacy_retry_failed' });
    }
  }

  return json({ processed, results });
}
