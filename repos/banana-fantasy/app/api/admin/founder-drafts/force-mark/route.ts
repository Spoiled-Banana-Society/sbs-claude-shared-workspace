import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { markFounderDraft } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/founder-drafts/force-mark
 * Body: { draftId, founderWallet, scheduleAt }
 *
 * Admin-only escape hatch for backfilling drafts that qualified as
 * Founder Drafts at fill-time but weren't persisted (e.g. because the
 * credit endpoint failed for unrelated reasons). Once a draft is marked,
 * the FounderPill renders for it forever and the live schedule is
 * irrelevant to the rendering decision.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const body = await parseBody(req);
    const draftId = requireString(body.draftId, 'draftId');
    const founderWallet = requireString(body.founderWallet, 'founderWallet');
    const scheduleAt = requireString(body.scheduleAt, 'scheduleAt');

    await markFounderDraft(draftId, { founderWallet, scheduleAt });
    return json({ ok: true, draftId }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.founder-drafts.force-mark.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
