import { NextRequest } from 'next/server';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  creditDepositCandidates,
  findDepositTransfersByTx,
  type DepositCreditResult,
} from '@/lib/purchases/creditCardDeposit';
import { pushStreamEventBg } from '@/lib/userEventStream';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Retro-credit specific card deposits that the client-fired credit call missed
 * (Add Funds modal closed before the USDC landed, so nothing was left watching
 * — 2026-07-29 audit found 4 users / 13 deposits shorted this way). Takes an
 * explicit audited {wallet, txHash} list, verifies each transfer on-chain from
 * the tx receipt, and runs the exact live credit math. Idempotent via the
 * shared `card_fee_credits` deposit markers — resubmitting a credited tx is a
 * no-op — so the route can be safely re-run.
 *
 * Backfill semantics (vs the live path): no firstDepositPassBudget seeding, no
 * deposit_completed feed row, no per-deposit "thanks for depositing" bell for
 * these days-old deposits — instead ONE promo-card-free-draft bell per user
 * who earned pass(es).
 *
 * Auth: `Authorization: Bearer ${PRIVY_EXPORT_SECRET}` — same local-script
 * admin pattern as card-fee-front-backfill.
 */
export async function POST(req: NextRequest) {
  const expected = (process.env.PRIVY_EXPORT_SECRET || '').trim();
  const auth = req.headers.get('authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonError('Unauthorized', 401);
  }

  let body: { items?: { wallet?: string; txHash?: string }[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) {
    return jsonError('items must contain 1-50 {wallet, txHash} entries', 400);
  }
  const dryRun = body.dryRun === true;

  const results: Array<Record<string, unknown>> = [];
  // wallet → passes earned across this run (fronted flag if any grant fronted)
  const perUser = new Map<string, { earned: number; fronted: boolean }>();

  for (const item of items) {
    const wallet = (item.wallet || '').toLowerCase();
    const txHash = (item.txHash || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet) || !/^0x[0-9a-f]{64}$/.test(txHash)) {
      results.push({ wallet, txHash, ok: false, error: 'bad wallet or txHash' });
      continue;
    }
    try {
      const candidates = await findDepositTransfersByTx(wallet, txHash);
      if (candidates.length === 0) {
        results.push({ wallet, txHash, ok: false, error: 'no USDC transfer to wallet in tx' });
        continue;
      }
      if (dryRun) {
        // blockNumber is a BigInt — JSON.stringify would throw on it.
        results.push({
          wallet, txHash, ok: true, dryRun: true,
          candidates: candidates.map((c) => ({
            txHash: c.txHash, logIndex: c.logIndex, from: c.from, valueUsd: c.valueUsd,
          })),
        });
        continue;
      }
      const res: DepositCreditResult = await creditDepositCandidates(wallet, candidates, {
        skipNewPlayerBudget: true,
        suppressActivity: true,
        suppressBell: true,
      });
      if (res.credited && res.earned > 0) {
        const agg = perUser.get(wallet) ?? { earned: 0, fronted: false };
        agg.earned += res.earned;
        agg.fronted = agg.fronted || res.fronted > 0;
        perUser.set(wallet, agg);
      }
      results.push({
        wallet, txHash, ok: true,
        credited: res.credited, amountUsd: res.amountUsd, feeCents: res.feeCents,
        earned: res.earned, fronted: res.fronted, rolloverCents: res.rolloverCents,
      });
      logger.info('admin.deposit_credit_backfill.item', { wallet, txHash, ...res });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      results.push({ wallet, txHash, ok: false, error: msg });
      logger.error('admin.deposit_credit_backfill.item_failed', { wallet, txHash, err: msg });
    }
  }

  // One aggregate bell per user who earned pass(es) — explains the program
  // instead of pretending a week-old deposit just landed.
  if (!dryRun) {
    for (const [wallet, agg] of perUser) {
      pushStreamEventBg(wallet, 'promo-card-free-draft', {
        awardedCount: agg.earned,
        fronted: agg.fronted,
      });
    }
  }

  return json({ dryRun, processed: results.length, results });
}
