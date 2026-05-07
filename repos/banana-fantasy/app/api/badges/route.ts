import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getUserBadges } from '@/lib/db';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import type { User } from '@/types';

/**
 * GET /api/badges?userId=X
 *
 * Public read. Returns the full catalog (so the client can render every
 * badge — locked greyed, unlocked colored), the user's unlock states,
 * and the equipped badge id. If userId isn't passed, returns just the
 * catalog (for logged-out catalog previews).
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const userId = getSearchParam(req, 'userId');
    if (!userId) {
      return json({ catalog: BADGE_CATALOG, unlocked: [], equipped: null }, 200);
    }

    const [badges, userSnap] = await Promise.all([
      getUserBadges(userId),
      getAdminFirestore().collection('v2_users').doc(userId).get(),
    ]);
    const user = userSnap.exists ? (userSnap.data() as User) : null;

    return json({
      catalog: BADGE_CATALOG,
      unlocked: badges.filter(b => b.unlocked).map(b => ({
        id: b.id,
        unlockedAt: b.unlockedAt ?? null,
      })),
      equipped: user?.equippedBadge ?? null,
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
