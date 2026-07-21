import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { createHash } from 'crypto';

import { json } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { isRollingActive, replayJpLane, replayHofLane, laneDraftsLeft, lanePct } from '@/lib/rollingLanes';

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
 *   • When the odds line is absent (all batch specials already hit), the
 *     name stands alone — end-of-batch uniqueness for X is handled by the
 *     repeat bananas below (the old one-per-draft slot ladder grew into a
 *     40-banana wall by slot ~179 and was removed 2026-07-18).
 *   • REPEAT bananas (Richard 2026-07-16): X silently rejects a post whose
 *     text matches a recent one. The odds line only keeps the countdown
 *     unique while the count moves FORWARD — when a player LEAVES, the count
 *     bounces back to a text that was already posted ("4 more…" → join →
 *     "3 more…" → leave → "4 more…" again) and X swallows it, which is why
 *     Twitter appeared to only announce joins while Discord (a webhook,
 *     no dup filter) showed both. Now every countdown text that would be a
 *     byte-copy of one already served gets a banana suffix — 1 🍌 on the
 *     first repeat, 2 on the second, and so on. Also covers two same-speed
 *     lobbies open at once repeating each other's texts (seen 2026-07-11).
 *     The "already served" ledger lives in Firestore (bot_feed_state/state,
 *     its own collection so nothing that iterates `drafts` ever sees it) —
 *     NOT in module memory, see the cache warning below.
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
  // Same as displayName but with NO bananas ever (no repeat-🍌 suffix, no
  // end-of-batch ladder) — odds line kept. For the Discord template: Discord
  // is a webhook with no duplicate filter, so it doesn't need the uniqueness
  // bananas that X does (Richard 2026-07-16). Unused until the bot's Discord
  // template is pointed at it.
  displayNameClean: string;
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

const NO_ODDS: Odds = { hofRemaining: 0, hofPercent: null, jackpotRemaining: 0, jackpotPercent: null };

// Ledger for the repeat-🍌 suffix (see header). `seen` counts how many times
// each exact countdown text (keyed by remaining-count + rendered name, since
// the bot's message is "{remaining} more to fill {displayName}") has been
// served; `lastServed` pins each filling draft's current text so it stays
// byte-stable between changes and the rename-race hold can replay it exactly.
interface ServedEntry {
  numPlayers: number;
  base: string; // text before any repeat-banana suffix
  final: string; // text actually served (base, or base + 🍌 suffix)
}
interface FeedState {
  seen: Record<string, { n: number; at: number }>;
  lastServed: Record<string, ServedEntry>;
}

// X's duplicate filter only looks back so far; no need to remember texts
// forever (and the ledger must stay far under Firestore's 1 MB doc cap).
const SEEN_TTL_MS = 48 * 60 * 60 * 1000;
const SEEN_MAX_ENTRIES = 3000;
const REPEAT_BANANA_CAP = 40; // keep well inside X's 280-char limit

const seenKey = (remaining: number, base: string) =>
  createHash('sha1').update(`${remaining}|${base}`).digest('hex').slice(0, 16);

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

  // Rolling reset windows (post-cutover): each lane has its own window, so
  // the odds come from the lane replays instead of the fixed 100-batch. Same
  // formula + toFixed(2) rendering downstream, so bot lines keep matching the
  // header exactly. Dormant until the tracker carries RollingStartDraft.
  const rollingStart = Number(tracker.RollingStartDraft ?? 0) || 0;
  if (isRollingActive(rollingStart, filled)) {
    const toIdsR = (v: unknown): number[] =>
      Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
    const jp = replayJpLane(toIdsR(tracker.JackpotLeagueIds), rollingStart, filled);
    const hof = replayHofLane(toIdsR(tracker.HofLeagueIds), rollingStart, filled);
    // No reveal gating here: the bot posts when a lobby opens, not at fills,
    // and its cadence (poll-driven) can't leak a reveal-in-flight meaningfully.
    return {
      jackpotRemaining: jp.remaining,
      hofRemaining: hof.remaining,
      jackpotPercent: lanePct(jp.remaining, laneDraftsLeft(filled, jp.windowStart)),
      hofPercent: lanePct(hof.remaining, laneDraftsLeft(filled, hof.windowStart)),
    };
  }

  const current = filled % BATCH_SIZE;
  const remainingSlots = BATCH_SIZE - current; // == BATCH_SIZE at a clean boundary
  if (remainingSlots <= 0) return NO_ODDS;
  // At a clean boundary (filled == 100, 200, …) the batch that's FILLING is the
  // NEXT one — fresh 1 JP + 5 HOF, zero hits. batchStart must be `filled` there,
  // not `filled - BATCH_SIZE`: pointing at the completed batch counted the OLD
  // batch's hits and killed the odds line for the whole first draft of a new
  // batch (League #101 showed no HOF/Jackpot %, 2026-07-08).
  const batchStart = filled - current;

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
  const stateRef = db.collection('bot_feed_state').doc('state');
  const [trackerSnap, snap, stateSnap] = await Promise.all([
    db.collection('drafts').doc('draftTracker').get(),
    db.collection('drafts').get(),
    // Ledger read failing must never take the feed down — degrade to serving
    // plain texts (and skip the write, so a bad read can't wipe the ledger).
    stateRef.get().catch((err) => {
      logger.error('[api/bot/league] feed-state read failed', err);
      return null;
    }),
  ]);

  const stateOk = stateSnap !== null;
  const rawState = stateSnap?.data() as Partial<FeedState> | undefined;
  const state: FeedState = {
    seen: rawState?.seen && typeof rawState.seen === 'object' ? rawState.seen : {},
    lastServed:
      rawState?.lastServed && typeof rawState.lastServed === 'object' ? rawState.lastServed : {},
  };
  let stateDirty = false;

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
  // HOF it leads); Jackpot is pushed first so the stable sort puts it ahead of
  // HOF on a tie (Richard 2026-07-16).
  const buildOddsLine = (o: Odds): string | null => {
    const parts: { label: string; pct: number }[] = [];
    if (o.jackpotPercent !== null) parts.push({ label: `Jackpot - ${o.jackpotPercent.toFixed(2)}%`, pct: o.jackpotPercent });
    if (o.hofPercent !== null) parts.push({ label: `HOF - ${o.hofPercent.toFixed(2)}%`, pct: o.hofPercent });
    parts.sort((a, b) => b.pct - a.pct);
    return parts.length ? parts.map((p) => p.label).join(' ') : null;
  };
  const oddsLine = buildOddsLine(odds);
  const oddsLinePreFill = buildOddsLine(oddsPreFill);

  // (The old slot-keyed 🍌 ladder that used to stand in when the odds line
  // was absent is GONE — by slot ~179 it had grown into a 40-banana wall
  // (2026-07-18). Its only job was keeping end-of-batch texts unique for X,
  // and the repeat-🍌 ledger below now does that properly: bananas appear
  // only when a text actually repeats, starting at one.)

  interface ParsedDraft {
    docId: string;
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
      docId: doc.id,
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

    // Rename still pending → keep reporting the draft exactly as the bot last
    // saw it, so it announces the fill ONCE — with the final league number —
    // on the next poll after the rename lands. The ledger's lastServed entry
    // IS the last text the bot saw (repeat bananas included), so replay it
    // verbatim; fall back to reconstructing the "1 more to fill" text if the
    // ledger has no entry (fresh ledger, or the read failed this poll).
    if (p.renamePending) {
      const stored = stateOk ? state.lastServed[p.docId] : undefined;
      const namePart = `Draft Lobby (${label})`;
      const held =
        stored?.final ?? (pendingOddsLine ? `${namePart}\n\n${pendingOddsLine}` : namePart);
      leagues.push({
        leagueId: p.leagueId,
        displayName: held,
        displayNameClean: pendingOddsLine ? `${namePart}\n\n${pendingOddsLine}` : namePart,
        numPlayers: stored ? stored.numPlayers : maxPlayers - 1,
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
    // No odds line (all batch specials hit) → just the name; the repeat-🍌
    // ledger below keeps end-of-batch texts unique for X, which is what the
    // old 40-banana slot ladder used to do.
    const base = draftOddsLine ? `${namePart}\n\n${draftOddsLine}` : namePart;

    let displayName = base;
    if (stateOk && !isFilled) {
      const stored = state.lastServed[p.docId];
      if (stored && stored.numPlayers === numPlayers && stored.base === base) {
        // Nothing changed since the last poll — serve the exact same text
        // (repeat bananas included) so the bot stays silent.
        displayName = stored.final;
      } else {
        // Text changed → the bot will post this. If this exact message
        // (remaining count + text) was already served recently, suffix one
        // banana per prior serving so X never sees a byte-duplicate.
        const key = seenKey(maxPlayers - numPlayers, base);
        const prior = state.seen[key]?.n ?? 0;
        displayName =
          prior > 0 ? `${base}\n\n${'🍌'.repeat(Math.min(prior, REPEAT_BANANA_CAP))}` : base;
        state.seen[key] = { n: prior + 1, at: Date.now() };
        state.lastServed[p.docId] = { numPlayers, base, final: displayName };
        stateDirty = true;
      }
    } else if (stateOk && state.lastServed[p.docId]) {
      // Filled and renamed — its countdown is over; drop the pin.
      delete state.lastServed[p.docId];
      stateDirty = true;
    }

    leagues.push({
      leagueId: p.leagueId,
      displayName,
      displayNameClean: draftOddsLine ? `${namePart}\n\n${draftOddsLine}` : namePart,
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

  // Persist the ledger (only when something changed — most polls change
  // nothing and stay read-only). Prune expired text keys and pins for drafts
  // that no longer exist so the doc can't grow without bound. A failed write
  // just means a repeat might slip through unbanana'd next poll — never
  // worth failing the feed over.
  if (stateOk && stateDirty) {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [k, v] of Object.entries(state.seen)) {
      if (!v || typeof v.at !== 'number' || v.at < cutoff) delete state.seen[k];
    }
    const seenKeys = Object.keys(state.seen);
    if (seenKeys.length > SEEN_MAX_ENTRIES) {
      seenKeys
        .sort((a, b) => state.seen[a].at - state.seen[b].at)
        .slice(0, seenKeys.length - SEEN_MAX_ENTRIES)
        .forEach((k) => delete state.seen[k]);
    }
    const liveDocIds = new Set(parsed.map((p) => p.docId));
    for (const k of Object.keys(state.lastServed)) {
      if (!liveDocIds.has(k)) delete state.lastServed[k];
    }
    try {
      await stateRef.set(state);
    } catch (err) {
      logger.error('[api/bot/league] feed-state write failed', err);
    }
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
