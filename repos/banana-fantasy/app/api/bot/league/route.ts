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
 *   • Plus a trailing banana line ("🍌🍌🍌…", one more per draft, cycling
 *     1→20) that keeps every message's text unique so X's duplicate-content
 *     filter can't silently swallow the countdown tweets.
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

// DO NOT add an in-memory response cache here. This route had a 15s module-scope
// cache; on Vercel that lives PER serverless instance, so with >1 warm instance
// the bot's polls round-robin between a fresh snapshot and a stale one. A player
// count that only ever increases while a draft fills then APPEARS to bounce
// (8 -> 7 -> 8), and the Discord bot pings on every change → duplicate "X more
// to fill" spam (reported 2026-06-28). Every read must reflect current Firestore
// so the count is monotonic. Firestore load is bounded by the rate-limiter below
// (600/min/IP) and a poll of ~35 docs is cheap.

interface Odds {
  // Remaining specials in the current 100-batch (5 HOF + 1 Jackpot at batch
  // start; each drops to 0 as its designated drafts fill).
  hofRemaining: number;
  jackpotRemaining: number;
  // Odds = remaining ÷ slots-left. null once that special is hit (0 left).
  hofPercent: number | null;
  jackpotPercent: number | null;
}

const NO_ODDS: Odds = { hofRemaining: 0, jackpotRemaining: 0, hofPercent: null, jackpotPercent: null };

/**
 * Current-batch HOF / Jackpot odds = remaining specials ÷ remaining slots in
 * the 100-draft batch. Mirrors the Go API (ReturnBatchProgress) and
 * lib/db-firestore.ts so the bot's odds always match the website's. Each
 * special's % drops as its drafts get hit, goes null once it's fully hit, and
 * resets when the next 100-batch starts (FilledLeaguesCount crosses the next
 * multiple of 100 and the committed positions roll forward).
 */
function computeOdds(tracker: Record<string, unknown> | undefined): Odds {
  if (!tracker) return NO_ODDS;
  const filled = Number(tracker.FilledLeaguesCount ?? 0) || 0;
  if (filled <= 0) return NO_ODDS;

  const current = filled % BATCH_SIZE;
  const remainingSlots = BATCH_SIZE - current; // == BATCH_SIZE at a clean boundary
  if (remainingSlots <= 0) return NO_ODDS;
  const batchStart = current === 0 ? filled - BATCH_SIZE : filled - current;

  const toIds = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
  const hofIds = toIds(tracker.HofLeagueIds);
  const jpIds = toIds(tracker.JackpotLeagueIds);
  const hitInBatch = (ids: number[]) =>
    ids.filter((id) => id > batchStart && id <= filled).length;

  const hofRemaining = Math.max(0, 5 - hitInBatch(hofIds));
  const jackpotRemaining = Math.max(0, 1 - hitInBatch(jpIds));

  return {
    hofRemaining,
    jackpotRemaining,
    hofPercent: hofRemaining > 0 ? (hofRemaining / remainingSlots) * 100 : null,
    jackpotPercent: jackpotRemaining > 0 ? (jackpotRemaining / remainingSlots) * 100 : null,
  };
}

async function loadLeagues(): Promise<AbbrevLeague[]> {
  const db = getAdminFirestore();
  const [trackerSnap, snap] = await Promise.all([
    db.collection('drafts').doc('draftTracker').get(),
    db.collection('drafts').get(),
  ]);

  const trackerData = trackerSnap.data() as Record<string, unknown> | undefined;
  const filledCount = Number(trackerData?.FilledLeaguesCount ?? 0) || 0;
  const odds = computeOdds(trackerData);
  // Pre-fill odds: the batch state as of ONE fill ago. Used ONLY for the draft
  // that just filled, so its "0 more to fill" % equals what it showed at "1/2
  // more to fill" — the % advances on the NEXT draft's countdown, never jumps on
  // a draft's own completion (Boris 2026-06-29). While a draft is still filling
  // it hasn't incremented FilledLeaguesCount, so the live odds are already its
  // pre-fill odds; only the just-filled draft needs the −1 adjustment.
  const oddsPreFill = computeOdds(
    trackerData ? { ...trackerData, FilledLeaguesCount: filledCount - 1 } : undefined,
  );

  // Drop a special from the line once it's been hit (no "0.00%"), and omit the
  // whole line once ALL specials in the batch are hit — it reappears on its own
  // when the next 100-batch begins. Highest % first (so if Jackpot ever exceeds
  // HOF it leads); stable sort keeps HOF before Jackpot on a tie.
  const buildOddsLine = (o: Odds): string | null => {
    const parts: { label: string; pct: number }[] = [];
    if (o.hofPercent !== null) parts.push({ label: `HOF - ${o.hofPercent.toFixed(2)}%`, pct: o.hofPercent });
    if (o.jackpotPercent !== null) parts.push({ label: `Jackpot - ${o.jackpotPercent.toFixed(2)}%`, pct: o.jackpotPercent });
    parts.sort((a, b) => b.pct - a.pct);
    return parts.length ? parts.map((p) => p.label).join(' ') : null;
  };
  const oddsLine = buildOddsLine(odds);
  const oddsLinePreFill = buildOddsLine(oddsPreFill);

  // 🍌 ladder — starts at ONE banana and adds one more each draft (Richard's
  // spec 2026-07-07). X silently rejects a post whose text is identical to a
  // recent one; the odds line used to keep countdown tweets unique by
  // accident, so when all the batch specials hit and the line dropped out
  // (2026-07-07), every "1 more to fill Draft Lobby (Fast)" became a
  // duplicate and the bot went quiet. Keyed to the draft's SLOT index so a
  // draft's bananas never change mid-countdown and the rename-race hold
  // below stays byte-identical to the bot's last message. The anchor is the
  // slot that was filling when this shipped (= 1 banana); the count wraps
  // back to 1 after 50 so the tweet never outgrows X's 280-char limit.
  const BANANA_ANCHOR: Record<string, number> = { fast: 90, slow: 5 };
  const bananaLine = (draftType: string, slot: number) => {
    const n = Math.max(1, slot - (BANANA_ANCHOR[draftType] ?? 0) + 1);
    return '🍌'.repeat(((n - 1) % 50) + 1);
  };

  interface ParsedDraft {
    leagueId: string;
    numPlayers: number;
    maxPlayers: number;
    draftType: string;
    isFilled: boolean;
    label: string;
    rawName: string;
    leagueNumber: number | null;
    renamePending: boolean;
    slotNumber: number;
  }

  // First pass: parse + filter every draft doc, and count the fills whose
  // rename has already landed (needed before we can emit any rename-pending
  // draft — see the RENAME RACE note below).
  const parsed: ParsedDraft[] = [];
  let renamedFillCount = 0;
  for (const doc of snap.docs) {
    if (!LEAGUE_ID_RE.test(doc.id)) continue;
    const d = doc.data() as Record<string, unknown>;

    // Skip wheel-won Jackpot/HOF lobbies — those run in their OWN lane (the
    // SpecialDraftCount sequence, named "HOF/Jackpot #N (from Wheel)" /
    // "Hall of Fame Draft #N") and shouldn't be announced; the bot only pings
    // for regular drafts (Boris 2026-06-30). A wheel special has its special
    // Level set WHILE filling AND a non-"BBB #" name; regular batch JP/HOF keep
    // the "BBB #N" name and only get their special Level after the slot reveal,
    // so this excludes only the wheel specials.
    const lvl = String(d.Level ?? '').toLowerCase().trim();
    const nm = String(d.DisplayName ?? '').trim();
    if ((lvl === 'jackpot' || lvl === 'hall of fame') && !/^bbb\b/i.test(nm)) continue;

    const numPlayers = Number(d.NumPlayers ?? 0);
    // Skip empty slot docs that exist but nobody has joined — nothing to announce.
    if (!Number.isFinite(numPlayers) || numPlayers <= 0) continue;

    const maxPlayers = Number(d.MaxPlayers ?? 10) || 10;
    const draftType = String(d.DraftType ?? '').toLowerCase() === 'slow' ? 'slow' : 'fast';
    const isFilled =
      (typeof d.IsLocked === 'boolean' ? d.IsLocked : false) || numPlayers >= maxPlayers;
    const label = draftType === 'slow' ? 'Slow' : 'Fast';

    // While filling, the doc's "BBB #N" is a temporary PER-SPEED slot number
    // that gets overwritten with the real global league number on fill (the
    // fast+slow FilledLeaguesCount — the same number the site's counter shows).
    const rawName = String(d.DisplayName ?? doc.id);
    const numMatch = /#\s*(\d+)/.exec(rawName);
    const leagueNumber = numMatch ? Number(numMatch[1]) : null;

    // RENAME RACE (bot announced "League #79" for what is League #82,
    // 2026-07-06): NumPlayers hits 10 a beat BEFORE the backend renames the
    // doc from its temp slot name ("BBB #79" on 2026-fast-draft-79) to the
    // real league number ("BBB #82"). A poll landing in that gap used to
    // announce the slot number as the league number. Real numbers are a
    // 1-based fill count across BOTH speeds, so once renamed the name always
    // moves PAST the 0-based slot index — a filled draft still wearing
    // exactly its slot number hasn't been renamed yet.
    const slotNumber = Number(/(\d+)$/.exec(doc.id)?.[1]);
    const renamePending = isFilled && leagueNumber !== null && leagueNumber === slotNumber;
    if (isFilled && leagueNumber !== null && !renamePending) renamedFillCount++;

    parsed.push({
      leagueId: String(d.LeagueId ?? doc.id),
      numPlayers,
      maxPlayers,
      draftType,
      isFilled,
      label,
      rawName,
      leagueNumber,
      renamePending,
      slotNumber,
    });
  }

  // Odds for a rename-pending draft: computed at "fills completed EXCLUDING
  // any pending one" (= renamedFillCount), NOT the tracker count — the tracker
  // may or may not have counted the in-flight fill yet, and the held message
  // must be byte-identical to the "1 more to fill" the bot last rendered so
  // it stays silent until the rename lands.
  const pendingOdds = trackerData
    ? computeOdds({ ...trackerData, FilledLeaguesCount: renamedFillCount })
    : NO_ODDS;
  const pendingOddsLine = buildOddsLine(pendingOdds);

  const leagues: AbbrevLeague[] = [];
  for (const p of parsed) {
    const { numPlayers, maxPlayers, draftType, isFilled, label, rawName, leagueNumber } = p;

    // Rename still pending → keep reporting the draft as one short of full,
    // exactly as the bot last saw it, so it announces the fill ONCE — with the
    // final league number — on the next poll after the rename lands.
    if (p.renamePending) {
      const namePart = `Draft Lobby (${label})`;
      const held = pendingOddsLine ? `${namePart}\n\n${pendingOddsLine}` : namePart;
      leagues.push({
        leagueId: p.leagueId,
        displayName: `${held}\n\n${bananaLine(draftType, p.slotNumber)}`,
        numPlayers: maxPlayers - 1,
        maxPlayers,
        draftType,
        isFilled: false,
        leagueNumber: null,
        state: 'filling',
        hofPercent: pendingOdds.hofPercent,
        jackpotPercent: pendingOdds.jackpotPercent,
      });
      continue;
    }

    const namePart = isFilled
      ? leagueNumber !== null
        ? `League #${leagueNumber} (${label})`
        : `${rawName} (${label})`
      : `Draft Lobby (${label})`;

    // The just-filled draft (its league # == the current batch count) shows its
    // PRE-fill odds, so "0 more to fill" reads the same JP/HOF % it showed at "2
    // more" / "1 more to fill" — no jump on its own completion. Filling drafts
    // already carry pre-fill odds (they haven't incremented the count yet), so
    // they keep the live odds. Same line for Discord and X (both read this route).
    const isLatestFill = isFilled && leagueNumber !== null && leagueNumber === filledCount;
    const draftOdds = isLatestFill ? oddsPreFill : odds;
    const draftOddsLine = isLatestFill ? oddsLinePreFill : oddsLine;

    // Blank line between the name and the odds line (matches the original
    // message spacing — two newlines render as a blank line in Discord).
    const displayName =
      (draftOddsLine ? `${namePart}\n\n${draftOddsLine}` : namePart) +
      `\n\n${bananaLine(draftType, p.slotNumber)}`;

    leagues.push({
      leagueId: p.leagueId,
      displayName,
      numPlayers,
      maxPlayers,
      draftType,
      isFilled,
      leagueNumber: isFilled ? leagueNumber : null,
      state: isFilled ? 'filled' : 'filling',
      hofPercent: draftOdds.hofPercent,
      jackpotPercent: draftOdds.jackpotPercent,
    });
  }

  // Stable, human-sensible order (numeric-aware on the league id).
  leagues.sort((a, b) =>
    a.leagueId.localeCompare(b.leagueId, undefined, { numeric: true }),
  );

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
