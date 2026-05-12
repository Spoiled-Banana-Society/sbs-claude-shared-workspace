import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getUserDisplayBatch } from '@/lib/db';
import { logger } from '@/lib/logger';

const MAX_BATCH = 30;
const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

// Server-side fetches must explicitly target the staging Go API. The
// shared `getDraftsApiUrl()` reads `isStagingMode()` which is window-only
// (returns prod URL on the server), so use the staging env var pattern
// the badges route already follows.
function getServerDraftsApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

interface OwnerPfp {
  displayName?: string;
  imageUrl?: string;
}
interface OwnerResponse {
  pfp?: OwnerPfp;
}

async function fetchGoApiPfp(wallet: string): Promise<OwnerPfp | null> {
  try {
    const res = await fetch(`${getServerDraftsApiUrl()}/owner/${wallet}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as OwnerResponse;
    return body.pfp ?? null;
  } catch (err) {
    logger.warn('users.display-batch.go-api-failed', { wallet, err });
    return null;
  }
}

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

    // 2. For wallets missing username OR pfp in v2_users, fall back to
    //    the Go API pfp record (legacy users who set their identity in
    //    the old draft frontend and haven't touched the new app yet).
    const needsGoApi = realWallets.filter(w => !v2[w]?.username || !v2[w]?.profilePicture);
    const goApiResults = await Promise.all(needsGoApi.map(async w => {
      const pfp = await fetchGoApiPfp(w);
      const dn = pfp?.displayName?.trim();
      return [w, {
        displayName: dn && dn.toLowerCase() !== w ? dn : null,
        imageUrl: pfp?.imageUrl || null,
      }] as const;
    }));
    const goApiData = Object.fromEntries(goApiResults);

    const out: Record<string, UserDisplay> = {};
    for (const w of realWallets) {
      const v = v2[w];
      out[w] = {
        displayName: v?.username || goApiData[w]?.displayName || null,
        imageUrl: v?.profilePicture || goApiData[w]?.imageUrl || null,
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
