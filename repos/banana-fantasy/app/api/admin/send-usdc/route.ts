/**
 * POST /api/admin/send-usdc  (Phase 2 — currently returns 501)
 *
 * Stubbed: real USDC movement from the admin wallet to a user (for
 * refunds, comps, bonuses) is a high-risk action that deserves
 * dedicated wiring — strict per-day caps, on-chain signing flow, the
 * existing `payment.admin_wallet_low_balance` alerting hook, etc.
 *
 * Right now the UI button shows in the User Lookup ActionsPanel so the
 * design is visible, but actual sends are gated until Phase 2 wires
 * the underlying transfer through the existing admin mint wallet
 * infrastructure (lib/onchain/adminMint.ts) with proper caps.
 */
import { ApiError } from '@/lib/api/errors';
import { jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    const body = await parseBody(req);
    const wallet = requireString(body.wallet, 'wallet').toLowerCase();
    const amount = requireNumber(body.amount, 'amount');
    const reason = requireString(body.reason, 'reason');

    if (!WALLET_REGEX.test(wallet)) throw new ApiError(400, 'wallet must be 40-hex');
    if (amount <= 0 || amount > 10000) throw new ApiError(400, 'amount out of range');

    // Log the attempt so it shows up in the audit trail even though
    // the actual transfer doesn't happen yet — gives Boris visibility
    // into "I tried to send X to Y" while the feature is gated.
    logger.warn('admin.send_usdc.not_implemented', {
      route: 'admin/send-usdc',
      actor: actorWallet,
      context: {
        targetWallet: wallet,
        amount,
        reason,
      },
    });

    return jsonError(
      'Send USDC isn\'t wired yet — coming in Phase 2 with daily caps + on-chain signing. Your attempt is logged in admin Logs.',
      501,
      { requestId },
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.send_usdc.unhandled', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/send-usdc',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
