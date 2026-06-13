const admin = require("firebase-admin");
const fetch = require("node-fetch");

/**
 * updateRosters (staging) — daily refresh of each team-position's player pool
 * (PlayersFromTeam) from the Rolling Insights depth-charts feed, so trades,
 * signings, and depth-chart moves flow into the draft board automatically.
 *
 * This replaces the old prod path (services/stat.js → analyzeData), which was
 * wired to the now-DEAD SportsData.io API. Source is Rolling Insights, the
 * provider already used for live scoring.
 *
 * Behaviour, per team-position in playerStats2026/playerMap.Players:
 *   - PlayersFromTeam <- current RI roster for that base position. Full depth,
 *     NO truncation, so a temporarily-injured star (e.g. Mahomes listed QB3
 *     while hurt) is never dropped from the pool.
 *   - Order: last-known starters that are still on the roster are kept at the
 *     FRONT (carry-over), so the feed's live injury-depth order can't bury an
 *     established starter. New arrivals follow in RI depth order.
 *   - ByeWeek <- the verified 2026 bye (static map below).
 *   - ADP is left untouched (owned by the hourly updateADP cron).
 *   - DST has no PlayersFromTeam (stays null), but its ByeWeek is still set.
 *
 * The Go draft API reads playerStats2026/playerMap fresh on every request, so
 * the board picks up the new rosters on the next read — no cache to bust.
 * Wired to a daily schedule in index.js (scheduledUpdateRosters).
 */

const SEASON_COLLECTION = "playerStats2026";
const PLAYER_MAP_DOC = "playerMap";
const RI_TOKEN = "44b29fbc16ba1b201e5b25a0bd26877abee8ad009bd13b9efd8ee892661f44fc";
const RI_DEPTH_URL =
  `https://rest.datafeeds.rolling-insights.com/api/v1/depth-charts/NFL?RSC_token=${RI_TOKEN}`;

const FULL_TO_ABBREV = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR",
  "Las Vegas Raiders": "LV", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "Seattle Seahawks": "SEA", "San Francisco 49ers": "SF", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

// Verified 2026 bye weeks (matched against the RI full-season schedule).
const BYES_2026 = {
  ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11,
  DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5,
  LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
  NYJ: 13, PHI: 10, PIT: 9, SEA: 11, SF: 8, TB: 10, TEN: 9, WAS: 7,
};

const TEAMS = Object.values(FULL_TO_ABBREV);
const POSITIONS = ["QB", "RB1", "RB2", "TE", "WR1", "WR2", "DST"];
const BASE_OF = { RB1: "RB", RB2: "RB", WR1: "WR", WR2: "WR" };

// Strip a trailing roman-numeral suffix (the RI feed sometimes appends a bad
// one, e.g. "James Cook Iii"). Removed per product request.
const ROMAN_SUFFIX = /\s+(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
function cleanName(n) {
  return String(n).replace(ROMAN_SUFFIX, "").trim();
}

// "1": {player}, "2": {player} -> ["..", ".."] in numeric depth order.
function flatten(m) {
  if (!m) return [];
  return Object.keys(m)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => m[k].player)
      .filter(Boolean)
      .map(cleanName);
}

function norm(n) {
  return String(n)
      .toLowerCase()
      .replace(/[.\-']/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
}

// Keep last-known starters that are still rostered at the front.
function carryover(priorNames, newList) {
  if (!priorNames || priorNames.length === 0) return newList;
  const newByNorm = new Map(newList.map((x) => [norm(x), x]));
  const front = [];
  const used = new Set();
  for (const p of priorNames) {
    const key = norm(p);
    if (newByNorm.has(key) && !used.has(key)) {
      front.push(newByNorm.get(key));
      used.add(key);
    }
  }
  const rest = newList.filter((x) => !used.has(norm(x)));
  return front.concat(rest);
}

async function updateRosters({ db } = {}) {
  db = db || admin.firestore();

  // 1. Pull the live depth charts.
  const resp = await fetch(RI_DEPTH_URL);
  if (!resp.ok) {
    throw new Error(`Rolling Insights depth-charts HTTP ${resp.status}`);
  }
  const payload = await resp.json();
  const nfl = payload && payload.data && payload.data.NFL;
  if (!nfl) throw new Error("Rolling Insights response missing data.NFL");

  // 2. Build per-team base-position rosters.
  const roster = {}; // abbrev -> { QB:[], RB:[], TE:[], WR:[] }
  for (const fullName of Object.keys(nfl)) {
    const ab = FULL_TO_ABBREV[fullName];
    if (!ab) continue;
    const pos = nfl[fullName];
    const wr1 = flatten(pos.WR1); const wr2 = flatten(pos.WR2); const wr3 = flatten(pos.WR3);
    const wr = [];
    const depth = Math.max(wr1.length, wr2.length, wr3.length);
    for (let i = 0; i < depth; i++) {
      for (const col of [wr1, wr2, wr3]) if (i < col.length) wr.push(col[i]);
    }
    roster[ab] = { QB: flatten(pos.QB), RB: flatten(pos.RB), TE: flatten(pos.TE), WR: wr };
  }

  // 3. Patch the season player map.
  const mapRef = db.collection(SEASON_COLLECTION).doc(PLAYER_MAP_DOC);
  const mapSnap = await mapRef.get();
  if (!mapSnap.exists) throw new Error(`${SEASON_COLLECTION}/${PLAYER_MAP_DOC} does not exist`);
  const statsMap = mapSnap.data() || {};
  if (!statsMap.Players) throw new Error(`${SEASON_COLLECTION}/${PLAYER_MAP_DOC} has no Players map`);

  let rostersUpdated = 0;
  let missing = 0;
  for (const team of TEAMS) {
    for (const position of POSITIONS) {
      const playerId = `${team}-${position}`;
      const entry = statsMap.Players[playerId];
      if (!entry) { missing += 1; continue; }
      entry.ByeWeek = String(BYES_2026[team]);
      if (position === "DST") continue; // no PlayersFromTeam for DST
      const base = BASE_OF[position] || position;
      const teamRoster = roster[team];
      if (!teamRoster || !teamRoster[base]) continue;
      const prior = Array.isArray(entry.PlayersFromTeam) ? entry.PlayersFromTeam : [];
      entry.PlayersFromTeam = carryover(prior, teamRoster[base]);
      rostersUpdated += 1;
    }
  }

  await mapRef.set(statsMap);
  return { rostersUpdated, missing, teams: Object.keys(roster).length };
}

module.exports = { updateRosters };
