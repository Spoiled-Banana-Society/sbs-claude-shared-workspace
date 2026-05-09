// Admin-only: grant a synthetic prize to a wallet for testing.
// Creates a doc in synthetic_prizes that surfaces on /prizes for the
// target wallet identical to a Go-API win, so end-to-end withdrawal
// flows can be tested without running a real draft.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireNumber, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { createSyntheticPrize } from '@/lib/prizeOverlay';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const targetWallet = requireString(body.walletAddress, 'walletAddress').trim();
    if (!ETH_ADDRESS_RE.test(targetWallet)) {
      throw new ApiError(400, 'Invalid walletAddress — must be a valid Ethereum address');
    }
    const amount = requireNumber(body.amount, 'amount');
    if (amount <= 0 || amount > 100000) {
      throw new ApiError(400, 'amount must be > 0 and ≤ 100000');
    }
    const contestNameRaw = typeof body.contestName === 'string' ? body.contestName.trim() : '';
    const contestName = contestNameRaw || 'Test prize';
    const draftId = typeof body.draftId === 'string' && body.draftId.trim() ? body.draftId.trim() : undefined;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;

    const prize = await createSyntheticPrize({
      userId: targetWallet,
      amount,
      contestName,
      draftId,
      note,
      grantedBy: actor,
    });
    if (!prize) throw new ApiError(503, 'Firestore not configured');

    await logAdminAction({
      actor,
      action: 'grant-prize',
      target: targetWallet.toLowerCase(),
      after: { prizeId: prize.id, amount, contestName },
      requestId,
    });

    logger.info('admin.grant_prize.ok', {
      requestId,
      actor,
      target: targetWallet.toLowerCase(),
      prizeId: prize.id,
      amount,
      durationMs: Date.now() - start,
    });

    return json({ prize, requestId });
  } catch (err) {
    logger.error('admin.grant_prize.failed', {
      requestId,
      actor,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
