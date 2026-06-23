// Admin-only: withdraw the BBB4 contract's accumulated USDC to the cold
// treasury. Same server-side skim used by the cron, but gated by the admin
// login (Privy JWT + allowlist) instead of CRON_SECRET — so Richard can pull
// funds manually from the admin panel with no secret, no Basescan, and WITHOUT
// ever loading the owner key into a wallet (which is what broke minting in Apr).
//
//   GET  → read-only balances + refund reserve (for the panel + a pre-withdraw preview)
//   POST → run the withdrawal (contract → ops wallet → cold treasury)

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { logger } from '@/lib/logger';
import { readBbb4Treasury, skimBbb4Usdc, SkimConfigError } from '@/lib/onchain/skimBbb4Usdc';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    const snapshot = await readBbb4Treasury();
    return json(snapshot, 200);
  } catch (err) {
    if (err instanceof SkimConfigError) return jsonError(err.message, err.status);
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('admin.withdraw-contract-usdc.read_failed', { err: (err as Error).message });
    return jsonError('Failed to read treasury balances', 500);
  }
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const result = await skimBbb4Usdc({ source: `admin:${actor}` });

    await logAdminAction({
      actor,
      action: 'withdraw-contract-usdc',
      target: result.treasury,
      after: {
        contractUsdcBefore: result.contractUsdcBefore,
        transferredToTreasury: result.transferredToTreasury,
        owedReserve: result.owedReserve,
        withdrawTxHash: result.withdrawTxHash,
        transferTxHash: result.transferTxHash,
        note: result.note,
      },
      requestId,
    });

    return json({ ok: true, ...result }, 200);
  } catch (err) {
    if (err instanceof SkimConfigError) return jsonError(err.message, err.status);
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.withdraw-contract-usdc.failed', { actor, err: (err as Error).message });
    return jsonError('Withdrawal failed', 500);
  }
}
