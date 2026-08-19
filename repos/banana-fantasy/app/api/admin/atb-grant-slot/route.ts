import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { recordAroundTheBanana, getAtbSeatCount } from '@/lib/aroundTheBanana';

/**
 * POST /api/admin/atb-grant-slot  { wallet, slot, reason? }
 *
 * Credits ONE Around-The-Banana slot to a wallet through the SAME engine path
 * a real draft fill uses (recordAroundTheBanana) — so a 10th slot wins the
 * seat, mints the Jackpot pass, seats them in the ATB lobby, and decrements
 * seats-left for everyone, exactly like organic. Uses a synthetic draft id
 * (`admin-grant-<ts>`) so the seen-ledger dedupe holds.
 *
 * First use: Boris 2026-08-18 — Banana69 at 9/10 (needs slot 4), his other
 * wallet held slot 4; treated as one player, given the seat on Banana69.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    const admin = await requireAdmin(req);
    const actor = admin.walletAddress ?? admin.userId;
    const body = await parseBody<{ wallet?: string; slot?: number; reason?: string }>(req);
    const wallet = String(body.wallet ?? '').trim().toLowerCase();
    const slot = Number(body.slot);
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new ApiError(400, 'Invalid wallet');
    if (!Number.isInteger(slot) || slot < 1 || slot > 10) throw new ApiError(400, 'slot must be 1–10');

    const db = getAdminFirestore();
    const ref = db.collection('v2_users').doc(wallet).collection('promos').doc('around-the-banana');
    const before = (await ref.get()).data()?.modalContent as Record<string, unknown> | undefined;
    if (!before) throw new ApiError(404, 'No ATB promo doc for this wallet');
    const beforeSlots = (before.atbSlotsHit as number[] | undefined) ?? [];

    const draftId = `admin-grant-${Date.now()}`;
    await recordAroundTheBanana(wallet, draftId, `Admin grant (${body.reason ?? 'no reason given'})`, slot);

    const after = (await ref.get()).data()?.modalContent as Record<string, unknown> | undefined;
    const seats = await getAtbSeatCount();
    await logAdminAction({
      actor, action: 'grant-drafts', target: wallet, requestId,
      before: { atbSlotsHit: beforeSlots },
      after: { atbSlotsHit: after?.atbSlotsHit, atbWonAt: after?.atbWonAt ?? null, atbSeatNumber: after?.atbSeatNumber ?? null, reason: body.reason ?? null, kind: 'atb-grant-slot', slot },
    });
    logger.info('admin.atb_grant_slot.ok', { requestId, actor, wallet, slot, after: after?.atbSlotsHit, seats });
    return json({ ok: true, wallet, slot, slotsHit: after?.atbSlotsHit ?? null, won: !!after?.atbWonAt && !!after?.atbCompletedAt, seatNumber: after?.atbSeatNumber ?? null, seats });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.atb_grant_slot.failed', { requestId, err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
