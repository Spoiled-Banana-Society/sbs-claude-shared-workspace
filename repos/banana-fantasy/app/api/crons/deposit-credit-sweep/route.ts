import { NextRequest } from 'next/server';
import { createPublicClient, http, parseAbiItem, type Address } from 'viem';

import { BASE, BASE_RPC_URL, BASE_SEPOLIA_USDC_ADDRESS } from '@/lib/contracts/bbb4';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { creditDepositCandidates, type DepositCandidate } from '@/lib/purchases/creditCardDeposit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Server-side card-fee credit sweep — the safety net behind the client-fired
 * credit call in AddFundsModal.
 *
 * WHY (2026-07-29 incident): the deposit credit used to fire ONLY from the
 * browser, after the arrival watcher saw the USDC land — with the Add Funds
 * modal still open. Close the modal (or rush off to buy passes, like the
 * jackpot-night traces show) and the credit silently never happened: 4 users /
 * 13 deposits / $77.79 in fees missed before this cron existed. The client
 * call stays (instant UX); this sweep guarantees eventual crediting.
 *
 * HOW: recent `deposit_funding_opened` breadcrumbs (v2_debug_events) are the
 * user's claims — the EMBEDDED Add Funds flow logs {amountUsd}, the web3 flow
 * logs {via: 'metamask_portfolio'} and is deliberately skipped (external-wallet
 * users still get no deposit credit — policy unchanged). For each claiming
 * wallet, scan recent on-chain USDC arrivals and credit any transfer that
 * matches a claimed amount within the same ±max($2, 10%) tolerance the live
 * route uses. Markers make crediting idempotent, so overlapping runs and the
 * client's own call can race safely.
 *
 * Trust note: the breadcrumb is client-written, but a spoofed claim still
 * needs a real matching on-chain arrival, and the payout math is bounded the
 * same way as the existing accepted self-report risk (~$435 claimed per
 * accumulator pass; sender + amount audited on every marker).
 */

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
// ⚠️ cache: 'no-store' is LOAD-BEARING. Next patches fetch in route handlers
// and caches identical requests — viem's eth_blockNumber POST body never
// changes, so without this the cron got a DAYS-old cached block height and
// scanned a 3h window from last week: green runs, zero credits, forever
// (caught 2026-08-04 via the heartbeat run-summary: latestBlockSeen was
// ~257k blocks behind the real chain).
const client = createPublicClient({
  chain: BASE,
  transport: http(BASE_RPC_URL, { fetchOptions: { cache: 'no-store' } }),
});

// Look back 3h of claims and blocks: MoonPay settlement can lag well past the
// modal's patience, and the 10-min cron cadence overlaps generously (markers
// dedupe re-scans).
const CLAIM_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const SCAN_BLOCKS = 5400n; // ~3h of 2s Base blocks

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore unavailable', 503);

  const db = getAdminFirestore();
  const cutoffIso = new Date(Date.now() - CLAIM_LOOKBACK_MS).toISOString();

  // 1. Recent embedded-flow deposit claims, grouped per wallet. Equality-only
  //    query (no composite index needed); time filter in memory.
  const snap = await db.collection('v2_debug_events')
    .where('event', '==', 'deposit_funding_opened')
    .get();
  const claimsByWallet = new Map<string, number[]>();
  for (const doc of snap.docs) {
    const d = doc.data();
    if ((d.serverTs ?? '') < cutoffIso) continue;
    const payload = (d.payload ?? {}) as { amountUsd?: number; via?: string };
    if (payload.via === 'metamask_portfolio') continue; // web3 — no credit, policy unchanged
    const amountUsd = Number(payload.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 5 || amountUsd > 10_000) continue;
    const wallet = (d.wallet ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) continue;
    const list = claimsByWallet.get(wallet) ?? [];
    if (!list.includes(amountUsd)) list.push(amountUsd);
    claimsByWallet.set(wallet, list);
  }

  let scanned = 0;
  let credited = 0;
  let earnedTotal = 0;
  const details: Array<Record<string, unknown>> = [];
  const scanErrors: string[] = [];
  const creditErrors: string[] = [];
  let transfersSeen = 0;
  let transfersMatched = 0;
  let latestBlockSeen = '';
  const rawLogCounts: Record<string, number> = {};

  if (claimsByWallet.size > 0) {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > SCAN_BLOCKS ? latest - SCAN_BLOCKS : 0n;
    latestBlockSeen = latest.toString();

    for (const [wallet, claimedAmounts] of claimsByWallet) {
      scanned++;
      let logs;
      try {
        logs = await client.getLogs({
          address: BASE_SEPOLIA_USDC_ADDRESS,
          event: TRANSFER_EVENT,
          args: { to: wallet as Address },
          fromBlock,
          toBlock: latest,
        });
      } catch (e) {
        scanErrors.push(`${wallet.slice(0, 10)}: ${(e as Error).message.slice(0, 120)}`);
        logger.warn('cron.deposit_sweep.scan_failed', { wallet, err: (e as Error).message });
        continue;
      }
      rawLogCounts[wallet.slice(0, 10)] = logs.length;
      for (const l of logs) {
        const from = (l.args.from ?? '').toLowerCase();
        if (from === wallet) continue;
        const valueUsd = Number(l.args.value ?? 0n) / 1e6;
        if (valueUsd < 5) continue;
        transfersSeen++;
        const matchedClaim = claimedAmounts.find(
          (c) => Math.abs(valueUsd - c) <= Math.max(2, c * 0.1),
        );
        if (matchedClaim == null) continue;
        transfersMatched++;
        const cand: DepositCandidate = {
          txHash: (l.transactionHash ?? '').toLowerCase(),
          logIndex: l.logIndex ?? 0,
          from,
          valueUsd,
          blockNumber: l.blockNumber ?? 0n,
        };
        if (!cand.txHash) continue;
        try {
          // Full live semantics (budget seeding, feed row, deposit bell) — this
          // is the same credit the modal would have fired, just guaranteed.
          const res = await creditDepositCandidates(wallet, [cand], { claimedAmountUsd: matchedClaim });
          if (res.credited) {
            credited++;
            earnedTotal += res.earned;
            details.push({ wallet, txHash: cand.txHash, valueUsd, feeCents: res.feeCents, earned: res.earned });
            logger.info('cron.deposit_sweep.credited', {
              wallet, txHash: cand.txHash, valueUsd, feeCents: res.feeCents, earned: res.earned,
            });
          }
        } catch (e) {
          creditErrors.push(`${wallet.slice(0, 10)}: ${(e as Error).message.slice(0, 120)}`);
          logger.warn('cron.deposit_sweep.credit_failed', { wallet, txHash: cand.txHash, err: (e as Error).message });
        }
      }
    }
  }

  await recordCronHeartbeat('deposit-credit-sweep', {
    claimsWallets: claimsByWallet.size,
    walletsScanned: scanned,
    transfersSeen,
    transfersMatched,
    credited,
    earnedTotal,
    latestBlockSeen,
    rawLogCounts,
    scanErrors: scanErrors.slice(0, 5),
    creditErrors: creditErrors.slice(0, 5),
  });
  return json({ walletsScanned: scanned, credited, earnedTotal, details });
}
