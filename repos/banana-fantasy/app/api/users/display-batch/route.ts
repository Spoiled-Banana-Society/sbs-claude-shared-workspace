import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getUserDisplayBatch, healUserPfpFromLegacy } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Ripeness } from '@/types';
import { bananaDefaultName, bananaPlaceholderName } from '@/utils/helpers';

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
    // ⚠️ `username` can be the INTERNAL placeholder `User-<first6>` (seeded by
    // createUser), which is truthy — so a bare `!username` check would skip
    // exactly the legacy users whose real name we're trying to recover.
    const needsName = (w: string) => {
      const u = v2[w]?.username;
      return !u || u.startsWith('User-');
    };
    const needsGoApi = realWallets.filter(w => needsName(w) || !v2[w]?.profilePicture);
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
      // Heal the NAME the same way. A returning player who set their identity
      // in the old draft frontend has their real handle ONLY in this Go pfp
      // record — v2_users still holds the internal `User-0x…` placeholder. Any
      // surface that doesn't call the Go API (promo boards, leaderboards) then
      // shows them as "Banana#####" instead of their name: Apevine read as
      // Banana10670 on the Drop winners list (Boris 2026-08-02).
      //
      // ⚠️ Through claimUsername, never a bare write — the handle needs its
      // reservation doc or two legacy users could end up holding one name.
      // A `taken`/`reserved` result is a no-op: they keep the placeholder and
      // can rename themselves, which is exactly the manual path Boris wants
      // preserved for returning players.
      // Skip the legacy system's OWN junk defaults ("User107744") — healing
      // those just swaps one placeholder for an uglier one, and it sticks:
      // the claim writes a real reservation, so the user then shows as
      // "User…" instead of their Banana##### default everywhere
      // (0x3def25…4614, Boris 2026-08-03). Real handles never match this.
      const isLegacyJunkName = (name: string) => /^user[-_ ]?\d+$/i.test(name);
      if (dn && needsName(w) && dn.toLowerCase() !== w && !isLegacyJunkName(dn)) {
        try {
          const { claimUsername } = await import('@/lib/usernames');
          const res = await claimUsername(dn, w);
          if (!res.available) logger.info('users.display-batch.legacy-name-skipped', { wallet: w, reason: res.reason });
        } catch (err) {
          logger.warn('users.display-batch.legacy-name-heal-failed', { wallet: w, err: String(err) });
        }
      }
      return [w, {
        // Junk defaults null out too — null makes every consumer fall back to
        // the Banana##### default, which is the identity these users should
        // have (a claimed junk name in v2_users is healed separately).
        displayName: dn && dn.toLowerCase() !== w && !isLegacyJunkName(dn) ? dn : null,
        imageUrl,
      }] as const;
    }));
    const goApiData = Object.fromEntries(goApiResults);

    const out: Record<string, UserDisplay> = {};
    for (const w of realWallets) {
      const v = v2[w];
      // Order: real username → legacy Go-API name → the SERVER-ASSIGNED
      // banana handle (v2_users.bananaNumber — unique counter, assigned on
      // first sight by getUserDisplayBatch above). NOT the wallet-hash
      // derivation: its 90k space let two users share one "Banana#####",
      // which mis-routed an admin pass grant on 2026-07-04. The header now
      // adopts THIS value at login (useAuth adoptServerHandle), so a user's
      // default still reads identically everywhere — Boris's 2026-06-11
      // referral-row/header mismatch stays fixed, at the correct source.
      // Neutral placeholder only if assignment transiently failed.
      const bananaName = v?.bananaNumber != null ? `Banana${v.bananaNumber}` : bananaPlaceholderName(w);
      // A freshly-seeded user gets the internal placeholder username
      // `User-<first6>` (db-firestore createUser). That's junk, never a display
      // name — reject it (exactly like the admin/activity/jackpot routes do) so
      // it falls through to the legacy Go name or the canonical Banana<last5>
      // default. Without this guard the draft room shows "User-0xebc6" instead
      // of "Banana12345"/the edited team name.
      const realUsername = v?.username && !v.username.startsWith('User-') ? v.username : null;
      const goName = goApiData[w]?.displayName;
      // Go displayName carrying the wallet's own HASH default is the app's
      // former auto-sync echo (updateUser mirrored the invented name), not a
      // chosen name — treat it as junk so the unique server number wins.
      const realGoName = goName && !goName.startsWith('User-') && goName !== bananaDefaultName(w) ? goName : null;
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
