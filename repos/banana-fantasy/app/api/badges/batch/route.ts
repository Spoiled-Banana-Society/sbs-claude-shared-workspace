import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getEquippedBadgesBatch } from '@/lib/db';

const MAX_BATCH = 50;

/**
 * POST /api/badges/batch
 * Body: { userIds: string[] }
 *
 * Returns equipped badges for a list of users in a single Firestore
 * read (getAll under the hood). Used by the leaderboard / draft-room /
 * marketplace render paths so we don't N+1-query when displaying many
 * users on one page.
 *
 * Public — equipped badges are intentionally observable; no auth gate.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const ids = Array.isArray(body.userIds) ? body.userIds : null;
    if (!ids) throw new ApiError(400, 'userIds array required');

    const normalized = Array.from(new Set(
      ids
        .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
        .map((x: string) => x.toLowerCase()),
    )).slice(0, MAX_BATCH);

    const equipped = await getEquippedBadgesBatch(normalized);
    return json({ equipped }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
