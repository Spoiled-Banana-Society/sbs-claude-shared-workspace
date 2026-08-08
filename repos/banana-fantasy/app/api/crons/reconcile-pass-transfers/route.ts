import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { reconcilePassesForWallet } from '@/lib/onchain/reconcilePasses';
import { BBB4_CONTRACT_ADDRESS, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Backstop for the Alchemy Transfer webhook: scans BBB4 Transfer events
 * directly from the chain and reconciles every affected wallet.
 *
 * The webhook (`/api/webhooks/alchemy/transfer`) is the only thing that keeps
 * pass inventory in sync when an NFT moves OUTSIDE the app — OTC wallet-to-
 * wallet sends, OpenSea-native sales, accepted offers. On 2026-08-04 it turned
 * out the webhook had never delivered a single event (`alchemy_webhook_events`
 * was empty since launch — the dashboard config predates the 6/22 contract
 * swap), so two OTC transfers left the sender with phantom spendable passes
 * and the recipients with nothing. This cron closes that hole from our side:
 * it needs no Alchemy dashboard config and heals the same way the webhook
 * would have, via `reconcilePassesForWallet` (idempotent — safe to run over
 * transfers the webhook or mint paths already handled).
 *
 * Cursor: `config/passTransferScan.lastScannedBlock`. Each run scans from a
 * few blocks before the cursor (cheap reorg insurance) up to the head, capped
 * at MAX_BLOCKS_PER_RUN so a long outage catches up over several runs instead
 * of blowing the RPC's getLogs range limit.
 */

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CURSOR_DOC = 'config/passTransferScan';
const ZERO = '0x0000000000000000000000000000000000000000';
// Public-node getLogs range limit is 10k blocks; stay under it. ~5h of Base
// blocks per run — a weekend-long outage catches up in a handful of runs.
const MAX_BLOCKS_PER_RUN = 9000;
// First run (no cursor yet) looks back ~1h; older drift is handled by the
// one-off backfill that shipped with this cron, not by scanning from genesis.
const INITIAL_LOOKBACK_BLOCKS = 1800;

interface RpcLog { topics: string[]; blockNumber: string; transactionHash: string }

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  // ⚠️ cache: 'no-store' is LOAD-BEARING (same trap as deposit-credit-sweep):
  // Next's route-handler fetch cache keys POSTs by URL+body, so without it
  // eth_blockNumber returns the deploy-day head forever and the scan freezes.
  const res = await fetch(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message ?? 'unknown error'}`);
  return body.result as T;
}

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  try {
    const db = getAdminFirestore();
    const cursorRef = db.doc(CURSOR_DOC);
    const latest = Number.parseInt(await rpc<string>('eth_blockNumber', []), 16);
    const cursor = (await cursorRef.get()).data()?.lastScannedBlock as number | undefined;

    // Re-scan a few blocks behind the cursor: reconcile is idempotent, and the
    // overlap means a small reorg can't permanently drop a transfer.
    const fromBlock = cursor ? Math.max(1, cursor - 4) : Math.max(1, latest - INITIAL_LOOKBACK_BLOCKS);
    const toBlock = Math.min(latest, fromBlock + MAX_BLOCKS_PER_RUN);
    if (fromBlock > latest) {
      await recordCronHeartbeat('reconcile-pass-transfers', { scanned: 0, wallets: 0 });
      return json({ ok: true, scanned: 0, wallets: 0 });
    }

    const logs = await rpc<RpcLog[]>('eth_getLogs', [{
      address: BBB4_CONTRACT_ADDRESS,
      topics: [TRANSFER_TOPIC],
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    }]);

    // Mints (from 0x0) are registered synchronously by every mint path, so a
    // pure mint needs no reconcile — but any wallet on EITHER side of a real
    // transfer does. Same wallet-extraction rules as the webhook route.
    const affected = new Set<string>();
    for (const l of logs) {
      const from = l.topics[1] ? `0x${l.topics[1].slice(26)}`.toLowerCase() : '';
      const to = l.topics[2] ? `0x${l.topics[2].slice(26)}`.toLowerCase() : '';
      if (from && to && from !== ZERO && to !== ZERO) {
        affected.add(from);
        affected.add(to);
      }
    }

    const results = await Promise.allSettled([...affected].map((w) => reconcilePassesForWallet(w)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;

    // Advance the cursor even when some wallets failed: the next run's overlap
    // window won't include these blocks forever, but a wallet whose reconcile
    // failed is retried on its NEXT transfer or via the admin endpoint — while
    // a stuck cursor would stall scanning for everyone.
    await cursorRef.set({ lastScannedBlock: toBlock, updatedAt: new Date().toISOString() }, { merge: true });

    if (affected.size > 0 || failed > 0) {
      logger.info('cron.reconcile_pass_transfers', {
        fromBlock,
        toBlock,
        transfers: logs.length,
        wallets: [...affected],
        reconciled: ok,
        failed,
      });
    }
    await recordCronHeartbeat('reconcile-pass-transfers', { fromBlock, toBlock, wallets: affected.size, failed });
    return json({ ok: true, fromBlock, toBlock, transfers: logs.length, wallets: affected.size, reconciled: ok, failed });
  } catch (err) {
    logger.error('cron.reconcile_pass_transfers_failed', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Internal Server Error', 500);
  }
}
