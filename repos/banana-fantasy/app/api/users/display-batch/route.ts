import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getUserDisplayBatch, healUserPfpFromLegacy } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Ripeness } from '@/types';
import { bananaDefaultName } from '@/utils/helpers';

const MAX_BATCH = 30;
const STAGING_DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

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
  // Edited PFPs live in the Go API owner record (NOT v2_users.profilePicture),
  // so this call is what surfaces a user's custom avatar in the draft room. A
  // single transient failure (flaky phone network, brief Go API hiccup) used to
  // silently null the PFP — and because the batch still returns 200, the outer
  // hook's retry never recovered it, so the avatar fell back to the banana for
  // the whole load (Boris's PFP missing on mobile / sometimes desktop). Retry
  // transient failures here, with a per-attempt timeout so one slow call can't
  // stall the whole batch.
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${getServerDraftsApiUrl()}/owner/${wallet}`, { cache: 'no-store', signal: ctrl.signal });
      if (res.ok) {
        const body = (await res.json()) as OwnerResponse;
        return body.pfp ?? null;
      }
      // non-OK (e.g. 5xx / 429) → treat as transient, fall through to retry
    } catch (err) {
      if (attempt === MAX - 1) logger.warn('users.display-batch.go-api-failed', { wallet, err });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX - 1) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

interface UserDisplay {
  displayName: string | null;
  imageUrl: string | null;
  equippedBadge: string | null;
  /** Ripeness tier — colors the user's default banana badge. */
  ripeness: Ripeness | null;
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
      const imageUrl = pfp?.imageUrl || null;
      // Heal-on-read: cache this legacy Go-API pfp into v2_users so the NEXT
      // load reads it from Firestore (fast/reliable) instead of re-hitting the
      // flaky Go API every time — the root cause of avatars flickering back to
      // the banana. Awaited (not fire-and-forget) so the write finishes inside
      // this serverless request; a post-response promise isn't guaranteed to
      // run on Vercel. try/catch so a heal failure never breaks the batch.
      if (imageUrl) {
        try { await healUserPfpFromLegacy(w, imageUrl); } catch { /* next load retries Go API */ }
      }
      return [w, {
        displayName: dn && dn.toLowerCase() !== w ? dn : null,
        imageUrl,
      }] as const;
    }));
    const goApiData = Object.fromEntries(goApiResults);

    const out: Record<string, UserDisplay> = {};
    for (const w of realWallets) {
      const v = v2[w];
      // Order: real username → legacy Go-API name → the wallet-derived
      // banana handle. The floor MUST be bananaDefaultName(wallet) — the
      // same derivation the header/profile uses — so a user's default reads
      // identically everywhere (the old server-assigned bananaNumber floor
      // made referral rows show a different "default" than the user's own
      // header, Boris 2026-06-11).
      const bananaName = bananaDefaultName(w);
      // A freshly-seeded user gets the internal placeholder username
      // `User-<first6>` (db-firestore createUser). That's junk, never a display
      // name — reject it (exactly like the admin/activity/jackpot routes do) so
      // it falls through to the legacy Go name or the canonical Banana<last5>
      // default. Without this guard the draft room shows "User-0xebc6" instead
      // of "Banana12345"/the edited team name.
      const realUsername = v?.username && !v.username.startsWith('User-') ? v.username : null;
      const goName = goApiData[w]?.displayName;
      const realGoName = goName && !goName.startsWith('User-') ? goName : null;
      out[w] = {
        displayName: realUsername || realGoName || bananaName,
        imageUrl: v?.profilePicture || goApiData[w]?.imageUrl || null,
        equippedBadge: v?.equippedBadge ?? null,
        ripeness: v?.ripeness ?? null,
      };
    }

    return json({ users: out }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('users.display-batch.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
