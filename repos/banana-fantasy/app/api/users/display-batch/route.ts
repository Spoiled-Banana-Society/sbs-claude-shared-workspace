import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getUserDisplayBatch } from '@/lib/db';
import { getOwnerProfile } from '@/lib/api/owner';
import { logger } from '@/lib/logger';

const MAX_BATCH = 30;

interface UserDisplay {
  displayName: string | null;
  imageUrl: string | null;
  equippedBadge: string | null;
}

/**
 * POST /api/users/display-batch
 * Body: { wallets: string[] }
 *
 * Returns the display-relevant fields (username + pfp + equipped badge)
 * for every wallet in a single round-trip. Used by the draft room so
 * all 10 slots can show real names + avatars + badges instead of
 * truncated wallet addresses.
 *
 * Source preference:
 *  1. Firestore `v2_users` — the new banana-fantasy username, pfp, and
 *     badge. This is the authoritative source for the new frontend.
 *  2. Go API `/owner/{wallet}.pfp` — legacy fallback for wallets that
 *     have never used the new frontend (so they have no v2_users doc)
 *     but did set a custom name in the old draft app.
 *
 * Bot wallets (prefix `bot-`) are skipped — no point hitting either
 * data source for them.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const raw = Array.isArray(body.wallets) ? body.wallets : null;
    if (!raw) throw new ApiError(400, 'wallets array required');

    const wallets = Array.from(new Set(
      raw
        .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
        .map((x: string) => x.toLowerCase()),
    )).slice(0, MAX_BATCH);

    const realWallets = wallets.filter(w => !w.startsWith('bot-'));

    // 1. Pull v2_users data for everyone (one Firestore getAll).
    const v2 = await getUserDisplayBatch(realWallets);

    // 2. For wallets missing a username in v2_users, fall back to Go API.
    const needsGoApi = realWallets.filter(w => !v2[w]?.username);
    const goApiResults = await Promise.all(needsGoApi.map(async w => {
      try {
        const p = await getOwnerProfile(w);
        const dn = p?.pfp?.displayName?.trim();
        return [w, dn && dn.toLowerCase() !== w ? dn : null] as const;
      } catch (err) {
        logger.warn('users.display-batch.go-api-failed', { wallet: w, err });
        return [w, null] as const;
      }
    }));
    const goApiNames = Object.fromEntries(goApiResults);

    const out: Record<string, UserDisplay> = {};
    for (const w of realWallets) {
      const v = v2[w];
      out[w] = {
        displayName: v?.username || goApiNames[w] || null,
        imageUrl: v?.profilePicture || null,
        equippedBadge: v?.equippedBadge ?? null,
      };
    }

    return json({ users: out }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('users.display-batch.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
