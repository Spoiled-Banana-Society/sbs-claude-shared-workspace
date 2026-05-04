import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/debug/force-special-draft
 *
 * Staging-only. Mutates `drafts/draftTracker` to mark a specific
 * FilledLeaguesCount slot as a Jackpot or HOF draft so testers can
 * trigger those reveals without filling 100 random drafts.
 *
 * Body: { type: 'jackpot' | 'hof', slot: number }
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Forbidden — staging only', 403);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      throw new ApiError(503, 'Firestore not configured');
    }
    const body = await parseBody(req);
    const type = requireString(body.type, 'type');
    const slot = Number(body.slot);
    if (!Number.isInteger(slot) || slot <= 0) {
      throw new ApiError(400, 'slot must be a positive integer');
    }
    if (type !== 'jackpot' && type !== 'hof') {
      throw new ApiError(400, "type must be 'jackpot' or 'hof'");
    }

    const db = getAdminFirestore();
    const ref = db.collection('drafts').doc('draftTracker');
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.data() ?? {}) as {
        FilledLeaguesCount?: number;
        JackpotLeagueIds?: number[];
        HofLeagueIds?: number[];
      };
      const filled = Number(data.FilledLeaguesCount ?? 0);
      if (slot <= filled) {
        throw new ApiError(400, `slot ${slot} has already been filled (current: ${filled})`);
      }
      const fieldName = type === 'jackpot' ? 'JackpotLeagueIds' : 'HofLeagueIds';
      const current = Array.isArray(data[fieldName]) ? (data[fieldName] as number[]) : [];
      const updated = Array.from(new Set([...current, slot])).sort((a, b) => a - b);
      tx.update(ref, { [fieldName]: updated });
      return { fieldName, before: current, after: updated, filled };
    });

    logger.info('debug.force_special_draft', { type, slot, ...result });
    return json({ success: true, type, slot, ...result }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('debug.force_special_draft.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
