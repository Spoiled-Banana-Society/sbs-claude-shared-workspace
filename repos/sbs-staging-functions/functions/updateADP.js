const admin = require("firebase-admin");

/**
 * updateADP (staging) — recompute Average Draft Position from completed drafts.
 *
 * Faithful port of prod's services/stat.js → updateADPForStats(), which was
 * never deployed on staging (that's why staging ADP has been frozen at the
 * 2026-02-06 snapshot). Everything here is Firestore — same as prod:
 *
 *   1. List doc ids in `drafts` (skip the `draftTracker` doc).
 *   2. A draft counts only if it ran to completion — detected as a full 150
 *      made picks in its playerState (staging never sets the IsLocked flag).
 *   3. Read `drafts/{id}/state/playerState` — a map playerId -> { PickNum }.
 *      Skip PickNum === 0 (player wasn't drafted).
 *   4. Average each `${team}-${position}` pick number, round it, and write into
 *      the `playerStats2024/playerMap` doc at `.Players[playerId].ADP`.
 *
 * Only difference from prod: prod's season collection is `playerStats2025`;
 * staging's is `playerStats2024` (SEASON_DOC below). The Go draft API reads
 * `playerStats2024/playerMap` fresh on every request, so the board picks up
 * the new ADP on the next read — no cache to bust.
 *
 * Wired to an hourly schedule in index.js (scheduledUpdateADP).
 */

const SEASON_COLLECTION = "playerStats2026";
const PLAYER_MAP_DOC = "playerMap";

// A standard draft is 10 players x 15 rounds = 150 picks. We treat a draft as
// "completed" when it has a full set of made picks. On staging the league
// doc's IsLocked flag is never set even after the final pick, so we detect
// completion from the pick data itself (the real signal) instead of the flag.
const DRAFT_PICK_COUNT = 150;

// Only let drafts completed AFTER the 2026 custom-rankings launch shape ADP.
// On staging there are ~197 OLD bot/test drafts whose pick patterns reflect
// LAST season's order (SF-RB1 #1, etc.). Folding those in every run snapped the
// ADP back to the old order and clobbered the seeded 2026 rankings. We don't
// pause the cron — we just ignore pre-launch drafts, so ADP holds at the seed
// until REAL 2026 drafts complete, then evolves from those going forward.
// A playerState doc's updateTime is the time of its final pick (it's never
// written again once a draft completes), so it's a reliable "completed at".
//
// Bumped 2026-06-23 12:10Z: the team finished pre-launch test drafting, so the
// cutoff moved from the 06-20 seed-launch to "now". Every draft up to this
// point (all of it test/bot traffic behind the prelaunch wall) is excluded;
// ADP holds at the clean seed and only REAL drafts completed from here on
// shape it. Richard's call — count from the very next draft onward.
const ADP_CUTOFF = new Date("2026-06-23T12:10:00Z");

// Same team / position keys prod uses (stat.js).
const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
  "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA",
  "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
  "TEN", "WAS",
];
const POSITIONS = ["QB", "RB1", "RB2", "TE", "WR1", "WR2", "DST"];

async function updateADP({ db } = {}) {
  db = db || admin.firestore();

  // 1. Every draft doc id, minus the tracker.
  const draftDocs = await db.collection("drafts").listDocuments();
  const leagueIds = draftDocs
      .map((d) => d.id)
      .filter((id) => id !== "draftTracker");

  // 2 + 3. Collect pick numbers per player from each COMPLETED draft. A draft
  // is completed when it has the full 150 made picks (see DRAFT_PICK_COUNT) —
  // detected from the pick data, NOT the league doc's IsLocked flag, which
  // staging never sets. Skip PickNum === 0 (player wasn't drafted).
  const pickMap = {}; // playerId -> number[]
  let draftsCounted = 0;
  let draftsSkipped = 0;
  let draftsBeforeCutoff = 0;

  for (const leagueId of leagueIds) {
    const stateSnap = await db
        .collection(`drafts/${leagueId}/state`)
        .doc("playerState")
        .get();
    if (!stateSnap.exists) {
      draftsSkipped += 1;
      continue;
    }

    // Skip drafts that completed before the rankings launch (see ADP_CUTOFF) —
    // they're old test/bot drafts that would revert ADP to last season's order.
    if (stateSnap.updateTime && stateSnap.updateTime.toDate() < ADP_CUTOFF) {
      draftsBeforeCutoff += 1;
      continue;
    }

    // Gather this league's made picks, then only fold them in if the draft
    // actually ran to completion (full set of picks).
    const draftPlayers = stateSnap.data() || {};
    const made = []; // [playerId, pickNum]
    for (const playerId of Object.keys(draftPlayers)) {
      const entry = draftPlayers[playerId];
      const pickNum = entry && typeof entry.PickNum === "number" ? entry.PickNum : 0;
      if (pickNum > 0) made.push([playerId, pickNum]);
    }

    if (made.length < DRAFT_PICK_COUNT) {
      draftsSkipped += 1; // unfinished / partial draft — don't pollute ADP
      continue;
    }
    draftsCounted += 1;

    for (const [playerId, pickNum] of made) {
      if (!pickMap[playerId]) pickMap[playerId] = [];
      pickMap[playerId].push(pickNum);
    }
  }

  // 4. Read the season player map, set ADP per team-position, write it back.
  const mapRef = db.collection(SEASON_COLLECTION).doc(PLAYER_MAP_DOC);
  const mapSnap = await mapRef.get();
  if (!mapSnap.exists) {
    throw new Error(`${SEASON_COLLECTION}/${PLAYER_MAP_DOC} does not exist`);
  }
  const statsMap = mapSnap.data() || {};
  if (!statsMap.Players) {
    throw new Error(`${SEASON_COLLECTION}/${PLAYER_MAP_DOC} has no Players map`);
  }

  let playersUpdated = 0;
  let playersMissing = 0;

  for (const team of TEAMS) {
    for (const position of POSITIONS) {
      const playerId = `${team}-${position}`;
      const picks = pickMap[playerId];
      if (!picks || picks.length === 0) continue; // never drafted → leave as-is
      if (!statsMap.Players[playerId]) {
        playersMissing += 1; // computed key not in the season map; skip safely
        continue;
      }
      const sum = picks.reduce((a, b) => a + b, 0);
      statsMap.Players[playerId].ADP = Math.round(sum / picks.length);
      playersUpdated += 1;
    }
  }

  await mapRef.set(statsMap);

  // After ADP is fresh, make every untouched user's default rankings track it
  // (skips anyone who genuinely customized). Wrapped so a failure here never
  // fails the ADP update itself.
  let rerank = null;
  try {
    const { rerankToFollowAdp } = require("./rerankRankings");
    rerank = await rerankToFollowAdp({ db });
  } catch (err) {
    console.error("[updateADP] rerankToFollowAdp failed (ADP still updated):", err);
    rerank = { error: String(err && err.message ? err.message : err) };
  }

  return { playersUpdated, draftsCounted, draftsSkipped, draftsBeforeCutoff, playersMissing, rerank };
}

module.exports = { updateADP };
