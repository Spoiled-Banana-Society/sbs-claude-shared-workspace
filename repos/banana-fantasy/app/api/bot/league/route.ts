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
 * covering BOTH fast and slow drafts.
 *
 * The bot only renders two tokens from this response — `{{leagueRemainingPlayers}}`
 * (derived from numPlayers/maxPlayers) and `{{leagueDisplayName}}` — and the
 * rest of its message is static template text. So everything dynamic is driven
 * through `displayName`:
 *
 *   • While FILLING  → "Draft Lobby (Fast)"   (the per-slot "BBB #" is just a
 *                       temporary slot number until the draft fills, so we hide
 *                       it and show a generic lobby name)
 *   • When FILLED    → "League #22 (Fast)"     (real, final league number)
 *   • Plus a live odds line baked on a second line:
 *                       "✅ HOF - 6.41% Jackpot - 1.28%"
 *     computed from the current 100-draft batch (1 Jackpot + 5 HOF per 100),
 *     so it climbs automatically as drafts fill without a hit — no more manual
 *     edits in the bot's AdminJS config.
 *
 * The raw numbers are ALSO exposed as their own fields (leagueNumber, state,
 * hofPercent, jackpotPercent) so the bot can later switch to real tokens
 * without another deploy here.
 *
 * Response shape stays a superset of the old endpoint, so the bot needs no code
 * change — only its base URL repointed here and a couple of one-time template
 * tweaks (drop the hardcoded odds line; change "more to fill Draft" → "more to
 * fill —" so the new name reads cleanly).
 *
 * ?include_unfilled=true → also return partially-filled drafts (what the bot
 * needs to compute "X more to fill"). Without it → filled drafts only.
 */

interface AbbrevLeague {
  leagueId: string;
  displayName: string;
  numPlayers: number;
  maxPlayers: number;
  draftType: string;
  isFilled: boolean;
  // Extra fields (ignored by the current bot; available for proper tokens later).
  leagueNumber: number | null;
  state: 'filling' | 'filled';
  hofPercent: number | null;
  jackpotPercent: number | null;
}

// Draft doc IDs look like "2026-fast-draft-15" / "2026-slow-draft-1". Anything
// else in the `drafts` collection (draftTracker, concurrency test docs, …) is
// not a league and is skipped.
const LEAGUE_ID_RE = /^\d{4}-(fast|slow)-draft-\d+$/;
const BATCH_SIZE = 100; // guaranteed distribution: 1 Jackpot + 5 HOF per 100

// Short per-(warm-)instance cache so frequent polling doesn't hammer Firestore.
const CACHE_MS = 15_000;
let cache: { at: number; data: AbbrevLeague[] } | null = null;

interface Odds {
  hofPercent: number | null;
  jackpotPercent: number | null;
}

/**
 * Current-batch HOF / Jackpot odds = remaining specials ÷ remaining slots in
 * the 100-draft batch. Mirrors the Go API (ReturnBatchProgress) and
 * lib/db-firestore.ts so the bot's odds always match the website's.
 */
function computeOdds(tracker: Record<string, unknown> | undefined): Odds {
  if (!tracker) return { hofPercent: null, jackpotPercent: null };
  const filled = Number(tracker.FilledLeaguesCount ?? 0) || 0;
  if (filled <= 0) return { hofPercent: null, jackpotPercent: null };

  const current = filled % BATCH_SIZE;
  const remainingSlots = BATCH_SIZE - current; // == BATCH_SIZE at a clean boundary
  const batchStart = current === 0 ? filled - BATCH_SIZE : filled - current;

  const toIds = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
  const hofIds = toIds(tracker.HofLeagueIds);
  const jpIds = toIds(tracker.JackpotLeagueIds);
  const hitInBatch = (ids: number[]) =>
    ids.filter((id) => id > batchStart && id <= filled).length;

  const hofRemaining = Math.max(0, 5 - hitInBatch(hofIds));
  const jackpotRemaining = Math.max(0, 1 - hitInBatch(jpIds));
  if (remainingSlots <= 0) return { hofPercent: null, jackpotPercent: null };

  return {
    hofPercent: (hofRemaining / remainingSlots) * 100,
    jackpotPercent: (jackpotRemaining / remainingSlots) * 100,
  };
}

async function loadLeagues(): Promise<AbbrevLeague[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const db = getAdminFirestore();
  const [trackerSnap, snap] = await Promise.all([
    db.collection('drafts').doc('draftTracker').get(),
    db.collection('drafts').get(),
  ]);

  const odds = computeOdds(trackerSnap.data() as Record<string, unknown> | undefined);
  const oddsLine =
    odds.hofPercent !== null && odds.jackpotPercent !== null
      ? `✅ HOF - ${odds.hofPercent.toFixed(2)}% Jackpot - ${odds.jackpotPercent.toFixed(2)}%`
      : null;

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
    const label = draftType === 'slow' ? 'Slow' : 'Fast';

    // While filling, the doc's "BBB #N" is a temporary slot number that gets
    // overwritten with the real league number on fill — so only trust it once
    // filled. League # maps directly to the BBB # (no test-draft offset).
    const rawName = String(d.DisplayName ?? doc.id);
    const numMatch = /#\s*(\d+)/.exec(rawName);
    const leagueNumber = numMatch ? Number(numMatch[1]) : null;

    const namePart = isFilled
      ? leagueNumber !== null
        ? `League #${leagueNumber} (${label})`
        : `${rawName} (${label})`
      : `Draft Lobby (${label})`;
    // Blank line between the name and the odds line (matches the original
    // message spacing — two newlines render as a blank line in Discord).
    const displayName = oddsLine ? `${namePart}\n\n${oddsLine}` : namePart;

    leagues.push({
      leagueId: String(d.LeagueId ?? doc.id),
      displayName,
      numPlayers,
      maxPlayers,
      draftType,
      isFilled,
      leagueNumber: isFilled ? leagueNumber : null,
      state: isFilled ? 'filled' : 'filling',
      hofPercent: odds.hofPercent,
      jackpotPercent: odds.jackpotPercent,
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
