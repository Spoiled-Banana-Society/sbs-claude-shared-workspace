const admin = require("firebase-admin");

/**
 * updateADP (staging) — recompute Average Draft Position from completed drafts.
 *
 * Faithful port of prod's services/stat.js → updateADPForStats(), which was
 * never deployed on staging (that's why staging ADP has been frozen at the
 * 2026-02-06 snapshot). Everything here is Firestore — same as prod:
 *
 *   1. List doc ids in `drafts` (skip the `draftTracker` doc).
 *   2. A draft counts only if its league doc has `IsLocked === true` (done).
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

const SEASON_COLLECTION = "playerStats2024";
const PLAYER_MAP_DOC = "playerMap";

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

  // 2 + 3. Collect pick numbers per player from each completed (IsLocked) draft.
  const pickMap = {}; // playerId -> number[]
  let draftsCounted = 0;
  let draftsSkipped = 0;

  for (const leagueId of leagueIds) {
    const leagueSnap = await db.collection("drafts").doc(leagueId).get();
    const league = leagueSnap.exists ? leagueSnap.data() : null;
    if (!league || !league.IsLocked) {
      draftsSkipped += 1;
      continue;
    }

    const stateSnap = await db
        .collection(`drafts/${leagueId}/state`)
        .doc("playerState")
        .get();
    if (!stateSnap.exists) {
      draftsSkipped += 1;
      continue;
    }
    draftsCounted += 1;

    const draftPlayers = stateSnap.data() || {};
    for (const playerId of Object.keys(draftPlayers)) {
      const entry = draftPlayers[playerId];
      const pickNum = entry && typeof entry.PickNum === "number" ? entry.PickNum : 0;
      if (pickNum === 0) continue; // not drafted in this league
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

  return { playersUpdated, draftsCounted, draftsSkipped, playersMissing };
}

module.exports = { updateADP };
