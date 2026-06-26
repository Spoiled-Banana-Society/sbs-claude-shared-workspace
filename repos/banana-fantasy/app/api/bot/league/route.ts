import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/bot/league?include_unfilled=true
 *
 * Drop-in replacement for the legacy Go drafts-API `/league` endpoint that the
 * Discord/Twitter "draft is filling" bot polls. That bot was still pointed at
 * last season's PROD drafts API, which only ever served 2025 full drafts — so
 * it had nothing to announce. This serves the LIVE current-season drafts
 * straight from Firestore (sbs-staging-env, the same data the live game uses),
 * covering BOTH fast and slow drafts, and bakes the draft type into
 * `displayName` so the alert reads "...BBB #15 (Slow)".
 *
 * The response shape matches the old endpoint EXACTLY so the bot needs no code
 * change — only its base URL repointed here:
 *   [{ leagueId, displayName, numPlayers, maxPlayers, draftType, isFilled }]
 *
 * Query:
 *   ?include_unfilled=true → also return partially-filled drafts (what the bot
 *   needs to compute "X more to fill"). Without it → filled drafts only.
 *
 * It reads the whole `drafts` collection, which in sbs-staging-env holds only
 * the current season's drafts (old seasons are wiped at cutover, so this stays
 * small), behind a short in-memory cache so a chatty poller doesn't do a full
 * collection read every few seconds. Year-prefix agnostic, so it keeps working
 * across the next season rollover with no change.
 */

interface AbbrevLeague {
  leagueId: string;
  displayName: string;
  numPlayers: number;
  maxPlayers: number;
  draftType: string;
  isFilled: boolean;
}

// Draft doc IDs look like "2026-fast-draft-15" / "2026-slow-draft-1". Anything
// else in the `drafts` collection (draftTracker, concurrency test docs, …) is
// not a league and is skipped.
const LEAGUE_ID_RE = /^\d{4}-(fast|slow)-draft-\d+$/;

// Short per-(warm-)instance cache so frequent polling doesn't hammer Firestore.
const CACHE_MS = 15_000;
let cache: { at: number; data: AbbrevLeague[] } | null = null;

async function loadLeagues(): Promise<AbbrevLeague[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const db = getAdminFirestore();
  const snap = await db.collection('drafts').get();

  const leagues: AbbrevLeague[] = [];
  for (const doc of snap.docs) {
    if (!LEAGUE_ID_RE.test(doc.id)) continue;
    const d = doc.data() as Record<string, unknown>;

    const numPlayers = Number(d.NumPlayers ?? 0);
    // Skip empty slot docs that exist but nobody has joined — nothing to announce.
    if (!Number.isFinite(numPlayers) || numPlayers <= 0) continue;

    const maxPlayers = Number(d.MaxPlayers ?? 10) || 10;
    const draftType = String(d.DraftType ?? '').toLowerCase() === 'slow' ? 'slow' : 'fast';
    const isFilled =
      (typeof d.IsLocked === 'boolean' ? d.IsLocked : false) || numPlayers >= maxPlayers;

    // Bake the type into the name so the alert says "(Fast)" / "(Slow)". The
    // league number itself is already a single sequential counter across both
    // speeds (Go assigns DisplayName from the combined FilledLeaguesCount), so
    // this only adds the missing word — it does not renumber anything.
    const base = String(d.DisplayName ?? doc.id);
    const label = draftType === 'slow' ? 'Slow' : 'Fast';

    leagues.push({
      leagueId: String(d.LeagueId ?? doc.id),
      displayName: `${base} (${label})`,
      numPlayers,
      maxPlayers,
      draftType,
      isFilled,
    });
  }

  // Stable, human-sensible order (numeric-aware on the league id).
  leagues.sort((a, b) =>
    a.leagueId.localeCompare(b.leagueId, undefined, { numeric: true }),
  );

  cache = { at: Date.now(), data: leagues };
  return leagues;
}

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  if (!isFirestoreConfigured()) return json([]);

  const includeUnfilled =
    new URL(req.url).searchParams.get('include_unfilled') === 'true';

  try {
    const all = await loadLeagues();
    const out = includeUnfilled ? all : all.filter((l) => l.isFilled);
    return json(out);
  } catch (err) {
    logger.error('[api/bot/league] failed to load leagues', err);
    return json([]);
  }
}
