import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getEquippedBadgesBatch } from '@/lib/db';
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
 * Returns the display-relevant fields (Go-API username/pfp + Firestore
 * equipped badge) for every wallet in a single round-trip from the
 * client. Used by the draft room so all 10 slots can show real names +
 * avatars + badges instead of truncated wallet addresses.
 *
 * Bot wallets (prefix `bot-`) are skipped — no point hitting the Go API
 * for them.
 *
 * Public — these fields are intentionally observable across users.
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

    const [profiles, equippedMap] = await Promise.all([
      Promise.all(realWallets.map(async w => {
        try {
          const p = await getOwnerProfile(w);
          return [w, p] as const;
        } catch (err) {
          logger.warn('users.display-batch.profile-failed', { wallet: w, err });
          return [w, null] as const;
        }
      })),
      getEquippedBadgesBatch(realWallets),
    ]);

    const out: Record<string, UserDisplay> = {};
    for (const [w, profile] of profiles) {
      const dn = profile?.pfp?.displayName?.trim() || null;
      // Go API stores the raw wallet in displayName for users who never
      // set a custom username — treat that as no display name.
      const displayName = dn && dn.toLowerCase() !== w ? dn : null;
      out[w] = {
        displayName,
        imageUrl: profile?.pfp?.imageUrl || null,
        equippedBadge: equippedMap[w] ?? null,
      };
    }

    return json({ users: out }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('users.display-batch.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
