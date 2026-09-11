#!/usr/bin/env node
/**
 * ESPN season scorer (Richard 2026-09-08/09: scoring is ESPN-fed and run by us;
 * Rolling Insights is retired).
 *
 * One run = one gameweek pass:
 *   1. ESPN scoreboard for the week → every game + live status.
 *   2. Per game: box score (per-player passing/rushing/receiving/fumbles) and
 *      the core competitor stats (team defense) → SBS fantasy points per player,
 *      then per NFL team the best-ball SLOT scores (QB, RB, RB2, WR, WR2, TE, DST)
 *      that SBS rosters are built from (players are team slots like MIN-RB1).
 *   3. Writes `scores/{gw}` in last season's `{FantasyPoints:[...]}` shape and
 *      `stats/{gw}` (per-player + per-defense audit rows).
 *   4. Scores every drafted BBB4 team (draftTokens with a roster), mirroring the
 *      old Go draftLeagueScorer exactly (sort each position by week score, flex =
 *      best leftover RB/WR/TE, lineup 1 QB / 2 RB / 2 WR / 1 TE / 1 Flex / 1 DST),
 *      ranks them, and writes:
 *        draftTokenLeaderboard/{gw}/cards/{cardId}      (global board — /api/leaderboard)
 *        drafts/{leagueId}/scores/{gw}/cards/{cardId}   (league board — Go league route)
 *        draftTokens/{cardId}, owners/{owner}/usedDraftTokens/{cardId},
 *        drafts/{leagueId}/cards/{cardId}               (Rank / LeagueRank / WeekScore /
 *                                                        SeasonScore strings the Teams page reads)
 *      Field names are Go struct-cased (ScoreWeek, Card, Roster…) because the
 *      Go API reads these docs with DataTo(&CardScores).
 *
 * Usage:
 *   node scripts/espn-scorer.mjs            dry run (prints, writes nothing)
 *   node scripts/espn-scorer.mjs --apply    write
 *   --week N        force a week (default: lib/season clock)
 *   --refresh       ignore the local token cache (re-read draftTokens)
 *   --seed          write every card even if unchanged
 * State/cache: ~/banana-fantasy/.espn-scorer/ (tokens.json, rosters.json, last-{gw}.json)
 */
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE_DIR = join(ROOT, '.espn-scorer');
mkdirSync(STATE_DIR, { recursive: true });

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = flag('--apply');
const SEED = flag('--seed');
const REFRESH = flag('--refresh');
const COMPARE = flag('--compare'); // print slot-by-slot diff vs the scores/{gw} doc already in Firestore (last season's RI output)

// ---- season clock (mirror of lib/season.ts) ---------------------------------
const SEASON_YEAR = Number(opt('--year') || 2026); // --year 2025 = validation runs against last season's feed
const WEEK1_ROLLOVER_MS = Date.UTC(2026, 8, 8, 10, 0, 0); // Tue Sep 8 2026 3:00 AM PT
const WEEK_MS = 7 * 24 * 3600 * 1000;
function currentWeekNumber(now = Date.now()) {
  return Math.min(18, Math.max(1, 1 + Math.floor((now - WEEK1_ROLLOVER_MS) / WEEK_MS)));
}
const WEEK = Number(opt('--week') || currentWeekNumber());
const GW = `${SEASON_YEAR}REG-${String(WEEK).padStart(2, '0')}`;
const PREV_GW = WEEK > 1 ? `${SEASON_YEAR}REG-${String(WEEK - 1).padStart(2, '0')}` : null;

// ---- firebase --------------------------------------------------------------
const src = readFileSync(join(ROOT, 'lib', 'firebaseAdmin.ts'), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const r2 = (n) => Math.round(n * 100) / 100;

// ---- ESPN ------------------------------------------------------------------
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const TEAM_ALIAS = { WSH: 'WAS' }; // ESPN → SBS abbreviations
const sbsTeam = (abbr) => TEAM_ALIAS[abbr] || abbr;
const SBS_TEAMS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'sbs-scorer/1.0' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

// athleteId → position, from the 32 team rosters (cached 24h)
async function loadPositions() {
  const f = join(STATE_DIR, 'rosters.json');
  if (!REFRESH && existsSync(f)) {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    if (Date.now() - c.at < 24 * 3600 * 1000) return c.map;
  }
  const teams = await getJson(`${SITE}/teams?limit=40`);
  const list = teams.sports[0].leagues[0].teams.map((t) => t.team);
  const map = {};
  for (const t of list) {
    const r = await getJson(`${SITE}/teams/${t.id}/roster`);
    for (const grp of r?.athletes || []) for (const a of grp.items || []) map[a.id] = a.position?.abbreviation || '';
  }
  writeFileSync(f, JSON.stringify({ at: Date.now(), map }));
  log('rosters refreshed', Object.keys(map).length, 'athletes');
  return map;
}

// A player missing from the cached rosters (call-up, mid-week signing, last
// season's feed in --year validation) → one core-API athlete lookup, cached.
async function lookupPosition(id, positions) {
  try {
    const a = await getJson(`${CORE}/athletes/${id}`);
    const pos = a?.position?.abbreviation || '';
    positions[id] = pos;
    const f = join(STATE_DIR, 'rosters.json');
    if (existsSync(f)) { const c = JSON.parse(readFileSync(f, 'utf8')); c.map[id] = pos; writeFileSync(f, JSON.stringify(c)); }
    return pos;
  } catch { return ''; }
}

const num = (v) => { const n = parseFloat(String(v ?? '0').split('/')[0]); return Number.isFinite(n) ? n : 0; };
const catVal = (cats, cat, stat) => {
  const c = cats.find((x) => x.name === cat); if (!c) return 0;
  const s = c.stats.find((x) => x.name === stat); return s ? num(s.value ?? s.displayValue) : 0;
};

function offensePoints(p) {
  let s = 0;
  s += p.passTD * 4 + p.passYds * 0.04 + (p.passYds >= 300 ? 3 : 0) - p.passInt;
  s += p.rushTD * 6 + p.rushYds * 0.1 + (p.rushYds >= 100 ? 3 : 0);
  s += p.recTD * 6 + p.recYds * 0.1 + (p.recYds >= 100 ? 3 : 0) + p.rec;
  s -= p.fumLost;
  s += p.twoPt * 2;
  return r2(s);
}
function pointsAllowedScore(pa) {
  if (pa === 0) return 10; if (pa <= 6) return 7; if (pa <= 13) return 4; if (pa <= 20) return 1;
  if (pa <= 27) return 0; if (pa <= 34) return -1; return -4;
}
function defensePoints(d) {
  return r2(d.sacks * 1 + d.int * 2 + d.fr * 1 + d.ff * 1 + d.safeties * 2 + d.td * 6 + d.blocked * 2 + pointsAllowedScore(d.pa));
}

/** Score one game → { [sbsTeam]: { players:[...], dst:{...}, status } } */
async function scoreGame(ev, positions) {
  const comp = ev.competitions[0];
  const state = comp.status.type.state; // pre | in | post
  const out = {};
  const teamsById = {};
  for (const c of comp.competitors) {
    const abbr = sbsTeam(c.team.abbreviation);
    teamsById[c.id] = abbr;
    out[abbr] = { players: [], dst: { team: abbr, pa: 0, sacks: 0, int: 0, fr: 0, ff: 0, safeties: 0, td: 0, blocked: 0 }, status: state, opp: null, score: num(c.score) };
  }
  const abbrs = Object.keys(out);
  out[abbrs[0]].opp = abbrs[1]; out[abbrs[1]].opp = abbrs[0];
  if (state === 'pre') return out;

  const sum = await getJson(`${SITE}/summary?event=${ev.id}`);
  const box = sum?.boxscore || {};
  // ---- offense from box score
  const byId = {};
  for (const t of box.players || []) {
    const abbr = sbsTeam(t.team.abbreviation);
    for (const cat of t.statistics || []) {
      const keys = cat.keys || [];
      for (const row of cat.athletes || []) {
        const a = row.athlete; const id = a.id;
        const p = byId[id] ||= { id, name: a.displayName, team: abbr, pos: positions[id] || '', passYds: 0, passTD: 0, passInt: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0, fumLost: 0, twoPt: 0, cats: new Set() };
        p.cats.add(cat.name);
        const v = (k) => { const i = keys.indexOf(k); return i >= 0 ? num(row.stats[i]) : 0; };
        if (cat.name === 'passing') { p.passYds = v('passingYards'); p.passTD = v('passingTouchdowns'); p.passInt = v('interceptions'); }
        if (cat.name === 'rushing') { p.rushYds = v('rushingYards'); p.rushTD = v('rushingTouchdowns'); }
        if (cat.name === 'receiving') { p.rec = v('receptions'); p.recYds = v('receivingYards'); p.recTD = v('receivingTouchdowns'); }
        if (cat.name === 'fumbles') { p.fumLost = v('fumblesLost'); }
      }
    }
  }
  // two-point conversions: "(Name Run for Two-Point Conversion)" / "(Name Pass to Name2 for Two-Point Conversion)"
  for (const sp of sum?.scoringPlays || []) {
    const txt = sp.text || '';
    if (!/Two-Point Conversion/i.test(txt) || /Fail/i.test(txt)) continue;
    const m = /\(([^)]*Two-Point Conversion[^)]*)\)/i.exec(txt); if (!m) continue;
    const names = m[1].replace(/for Two-Point Conversion/i, '').replace(/\b(Run|Pass to|Pass|Rush)\b/gi, '|').split('|').map((s) => s.trim()).filter(Boolean);
    const teamAbbr = sbsTeam(sp.team?.abbreviation || '');
    for (const nm of names) {
      const p = Object.values(byId).find((x) => x.team === teamAbbr && x.name === nm);
      if (p) p.twoPt += 1;
    }
    if (/Safety/i.test(sp.type?.text || '')) { /* handled below via core stats */ }
  }
  for (const p of Object.values(byId)) {
    if (!p.pos) p.pos = await lookupPosition(p.id, positions);
    if (!p.pos) p.pos = p.cats.has('passing') ? 'QB' : p.cats.has('rushing') && !p.cats.has('receiving') ? 'RB' : p.cats.has('receiving') ? 'WR' : '';
    if (p.pos === 'FB') p.pos = 'RB';
    p.points = offensePoints(p);
    delete p.cats;
    out[p.team]?.players.push(p);
  }
  // ---- defense: core competitor stats (fallback: box-score team stats)
  for (const c of comp.competitors) {
    const abbr = teamsById[c.id]; const d = out[abbr].dst; const opp = out[out[abbr].opp];
    d.pa = opp.score;
    const core = await getJson(`${CORE}/events/${ev.id}/competitions/${ev.id}/competitors/${c.id}/statistics`).catch(() => null);
    const cats = core?.splits?.categories;
    if (cats) {
      d.sacks = catVal(cats, 'defensive', 'sacks');
      d.int = catVal(cats, 'defensiveInterceptions', 'interceptions');
      d.safeties = catVal(cats, 'defensive', 'safeties');
      d.blocked = catVal(cats, 'defensive', 'kicksBlocked');
      d.td = catVal(cats, 'defensive', 'defensiveTouchdowns') + catVal(cats, 'returning', 'kickReturnTouchdowns') + catVal(cats, 'returning', 'puntReturnTouchdowns');
      d.ff = catVal(cats, 'general', 'fumblesForced');
    }
    // fumble recoveries = opponent fumbles lost (box-score team stats)
    const oppTeam = (box.teams || []).find((t) => sbsTeam(t.team.abbreviation) === out[abbr].opp);
    const fl = oppTeam?.statistics?.find((s) => s.name === 'fumblesLost');
    d.fr = fl ? num(fl.displayValue) : d.fr;
    if (!cats) {
      const me = (box.teams || []).find((t) => sbsTeam(t.team.abbreviation) === abbr);
      const st = (n) => num(me?.statistics?.find((s) => s.name === n)?.displayValue);
      const oppSt = (n) => num(oppTeam?.statistics?.find((s) => s.name === n)?.displayValue);
      d.int = oppSt('interceptions'); d.sacks = num(String(oppTeam?.statistics?.find((s) => s.name === 'sacksYardsLost')?.displayValue || '0').split('-')[0]); d.td = st('defensiveTouchdowns');
    }
    if (!d.ff) d.ff = d.fr;
    d.points = defensePoints(d);
  }
  return out;
}

/** Whole week → { teamScores: {abbr: Score}, players: [], defenses: [], games } */
async function scoreWeek(positions) {
  const sb = await getJson(`${SITE}/scoreboard?dates=${SEASON_YEAR}&seasontype=2&week=${WEEK}`);
  const events = sb?.events || [];
  const teamScores = {}; const players = []; const defenses = []; const games = [];
  for (const abbr of SBS_TEAMS) teamScores[abbr] = { Team: abbr, QB: 0, RB: 0, RB2: 0, WR: 0, WR2: 0, TE: 0, DST: 0, GameStatus: 'bye' };
  for (const ev of events) {
    const g = await scoreGame(ev, positions);
    games.push({ id: ev.id, name: ev.shortName, date: ev.date, state: ev.competitions[0].status.type.state, detail: ev.competitions[0].status.type.shortDetail });
    for (const [abbr, t] of Object.entries(g)) {
      const top = (pos, n) => t.players.filter((p) => p.pos === pos).map((p) => p.points).sort((a, b) => b - a)[n] ?? 0;
      teamScores[abbr] = { Team: abbr, QB: top('QB', 0), RB: top('RB', 0), RB2: top('RB', 1), WR: top('WR', 0), WR2: top('WR', 1), TE: top('TE', 0), DST: t.status === 'pre' ? 0 : t.dst.points, GameStatus: t.status };
      players.push(...t.players); if (t.status !== 'pre') defenses.push(t.dst);
    }
  }
  return { teamScores, players, defenses, games };
}

// ---- cards -----------------------------------------------------------------
async function loadTokens() {
  const f = join(STATE_DIR, 'tokens.json');
  if (!REFRESH && existsSync(f)) {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    if (Date.now() - c.at < 20 * 60 * 1000) return c; // 20 min: drafts still finishing tonight get picked up
  }
  const t0 = Date.now();
  const snap = await db.collection('draftTokens').get();
  const tokens = [];
  const rosterSize = (r) => (r ? ['QB', 'RB', 'WR', 'TE', 'DST'].reduce((s, p) => s + (r[p] || []).length, 0) : 0);
  const missing = {}; // leagueId → [{doc, d}] tokens seated in a league but with no roster on the token record
  const rosteredPerLeague = {};
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d.LeagueId) return;
    if (d.LeagueDisplayName === 'BBB #133') return; // dead league — excluded from every total
    if (rosterSize(d.Roster) < 10) { (missing[d.LeagueId] ||= []).push({ doc, d }); return; }
    rosteredPerLeague[d.LeagueId] = (rosteredPerLeague[d.LeagueId] || 0) + 1;
    tokens.push({ id: doc.id, card: d });
  });
  // Only leagues whose draft clearly finished (most tokens already rostered) —
  // the Go rosters endpoint also answers for drafts still in progress.
  for (const lid of Object.keys(missing)) if ((rosteredPerLeague[lid] || 0) < 8) delete missing[lid];
  // Roster fallback (9/9: 6 drafted teams across 5 leagues had an EMPTY roster on
  // every Firestore token copy, while the Go draft state had the full roster).
  // Pull /draft/{id}/state/rosters for those leagues, score from it, and heal
  // the token copies so the Teams page shows the roster too.
  const GO = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
  let healed = 0;
  for (const [lid, list] of Object.entries(missing)) {
    let go = null;
    try { const r = await fetch(`${GO}/draft/${lid}/state/rosters`); if (r.ok) go = await r.json(); } catch { /* filling / unavailable */ }
    if (!go || typeof go !== 'object') continue;
    for (const { doc, d } of list) {
      const key = Object.keys(go).find((k) => k.toLowerCase() === String(d.OwnerId || '').toLowerCase());
      if (!key) continue;
      const roster = {};
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST']) roster[pos] = (go[key][pos] || []).map((p) => ({ PlayerId: p.playerId, Team: p.playerStateInfo?.team || String(p.playerId).split('-')[0], DisplayName: p.playerStateInfo?.displayName || p.playerId }));
      if (rosterSize(roster) < 10) continue;
      d.Roster = roster;
      tokens.push({ id: doc.id, card: d });
      healed++;
      log(`roster from Go for ${lid} token ${doc.id} (${rosterSize(roster)} slots)${APPLY ? ' — healing token copies' : ''}`);
      if (APPLY) {
        const patch = { Roster: roster };
        await Promise.allSettled([
          db.doc(`draftTokens/${doc.id}`).update(patch),
          d.OwnerId ? db.doc(`owners/${d.OwnerId}/usedDraftTokens/${doc.id}`).update(patch) : Promise.resolve(),
          db.doc(`drafts/${lid}/cards/${doc.id}`).update(patch),
        ]);
      }
    }
  }
  if (healed) log('rosters recovered from Go:', healed);
  // owner PFPs (display name on the board)
  const owners = [...new Set(tokens.map((t) => String(t.card.OwnerId || '').toLowerCase()).filter(Boolean))];
  const pfps = {};
  for (let i = 0; i < owners.length; i += 300) {
    const refs = owners.slice(i, i + 300).map((w) => db.collection('owners').doc(w));
    const docs = await db.getAll(...refs);
    docs.forEach((d, j) => { const p = d.exists ? d.data().PFP : null; pfps[owners[i + j]] = p ? { ImageUrl: p.ImageUrl || '', NftContract: p.NftContract || '', DisplayName: p.DisplayName || '' } : { ImageUrl: '', NftContract: '', DisplayName: '' }; });
  }
  const refunded = new Set((await db.collection('refundedLeagues').get()).docs.map((d) => d.id));
  const c = { at: Date.now(), tokens: tokens.filter((t) => !refunded.has(t.card.LeagueId)), pfps };
  writeFileSync(f, JSON.stringify(c));
  log('tokens loaded', c.tokens.length, 'owners', owners.length, 'in', Date.now() - t0, 'ms');
  return c;
}

async function loadPrevSeason() {
  if (!PREV_GW) return {};
  const f = join(STATE_DIR, `season-${PREV_GW}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const snap = await db.collection(`draftTokenLeaderboard/${PREV_GW}/cards`).select('ScoreSeason', 'Roster').get();
  const m = {};
  snap.forEach((d) => { const x = d.data(); const per = {}; for (const pos of ['QB','RB','WR','TE','DST']) for (const p of x.Roster?.[pos] || []) per[p.PlayerId] = p.ScoreSeason || 0; m[d.id] = { season: x.ScoreSeason || 0, per }; });
  writeFileSync(f, JSON.stringify(m));
  return m;
}

const sortDesc = (arr) => arr.sort((a, b) => b.ScoreWeek - a.ScoreWeek);
function scoreCard(tok, teamScores, prev) {
  const card = tok.card; const R = card.Roster;
  const mk = (p, pos, slot) => ({ PlayerId: p.PlayerId, Team: p.Team, Position: pos, ScoreWeek: teamScores[p.Team]?.[slot] ?? 0, PrevWeekSeasonContribution: prev?.per?.[p.PlayerId] ?? 0, ScoreSeason: 0, IsUsedInCardScore: false });
  const roster = {
    DST: sortDesc((R.DST || []).map((p) => mk(p, 'DST', 'DST'))),
    QB: sortDesc((R.QB || []).map((p) => mk(p, 'QB', 'QB'))),
    RB: sortDesc((R.RB || []).map((p) => mk(p, 'RB', p.PlayerId.endsWith('RB2') ? 'RB2' : 'RB'))),
    TE: sortDesc((R.TE || []).map((p) => mk(p, 'TE', 'TE'))),
    WR: sortDesc((R.WR || []).map((p) => mk(p, 'WR', p.PlayerId.endsWith('WR2') ? 'WR2' : 'WR'))),
  };
  const flexPool = [...roster.RB.slice(2), ...roster.TE.slice(1), ...roster.WR.slice(2)];
  const flex = flexPool.length ? sortDesc(flexPool)[0] : null;
  const starters = [roster.DST[0], roster.QB[0], roster.RB[0], roster.RB[1], roster.TE[0], roster.WR[0], roster.WR[1], flex].filter(Boolean);
  let week = 0; for (const s of starters) { s.IsUsedInCardScore = true; week += s.ScoreWeek; }
  for (const pos of Object.keys(roster)) for (const p of roster[pos]) p.ScoreSeason = r2(p.PrevWeekSeasonContribution + (p.IsUsedInCardScore ? p.ScoreWeek : 0));
  const prevSeason = prev?.season ?? 0;
  return { CardId: tok.id, Card: card, Roster: roster, ScoreWeek: r2(week), ScoreSeason: r2(prevSeason + week), PrevWeekSeasonScore: prevSeason, OwnerId: card.OwnerId || '', Level: card.Level || 'Pro' };
}

async function main() {
  log(`ESPN scorer gw=${GW} apply=${APPLY} seed=${SEED}`);
  const positions = await loadPositions();
  const wk = await scoreWeek(positions);
  const live = wk.games.filter((g) => g.state === 'in').length, done = wk.games.filter((g) => g.state === 'post').length;
  log(`games: ${wk.games.length} (live ${live}, final ${done}), scored players ${wk.players.length}`);
  for (const g of wk.games) if (g.state !== 'pre') log('  ', g.name, g.state, g.detail);
  const topTeams = Object.values(wk.teamScores).filter((t) => t.GameStatus !== 'pre' && t.GameStatus !== 'bye');
  for (const t of topTeams) log('  ', t.Team, t.GameStatus, `QB ${t.QB} RB ${t.RB}/${t.RB2} WR ${t.WR}/${t.WR2} TE ${t.TE} DST ${t.DST}`);

  const scoresDoc = { FantasyPoints: SBS_TEAMS.map((a) => wk.teamScores[a]) };
  if (COMPARE) {
    const ref = (await db.collection('scores').doc(GW).get()).data();
    const refMap = {}; for (const t of ref?.FantasyPoints || []) refMap[t.Team] = t;
    let n = 0, sumAbs = 0, big = [];
    for (const t of scoresDoc.FantasyPoints) for (const slot of ['QB','RB','RB2','WR','WR2','TE','DST']) {
      const a = t[slot], b = refMap[t.Team]?.[slot]; if (b == null) continue;
      n++; sumAbs += Math.abs(a - b); if (Math.abs(a - b) >= 3) big.push(`${t.Team}-${slot} espn=${a} ref=${b}`);
    }
    log(`COMPARE vs scores/${GW}: slots=${n} meanAbsDiff=${r2(sumAbs / Math.max(1, n))} diffs>=3: ${big.length}`);
    for (const b of big.slice(0, 40)) log('   ', b);
    return;
  }
  // Idle skip (Boris 2026-09-11): scores cannot move while no game is in progress. If the previous pass already
  // applied the same set of finals for this gameweek, stop here — before the token/prev-season reads and the card
  // scoring — and just refresh the heartbeat. Any game going live (or a new final) makes the next pass run fully.
  if (APPLY && !SEED && live === 0) {
    const hb = (await db.collection('cron_heartbeats').doc('espn-scorer').get()).data() || {};
    if (hb.gameweek === GW && hb.games === wk.games.length && hb.final === done && (hb.live ?? 0) === 0) {
      await db.collection('cron_heartbeats').doc('espn-scorer').set({ at: new Date().toISOString(), skipped: 'no live games, finals already applied' }, { merge: true });
      log(`no live games and ${done}/${wk.games.length} finals already applied — skipping pass`);
      return;
    }
  }
  const statsDoc = { source: 'espn', gameweek: GW, updatedAt: new Date().toISOString(), games: wk.games, offense: wk.players.map((p) => ({ ...p })), defense: wk.defenses };
  if (APPLY) {
    await db.collection('scores').doc(GW).set(scoresDoc);
    await db.collection('stats').doc(GW).set(statsDoc);
  }

  const { tokens, pfps } = await loadTokens();
  const prevAll = await loadPrevSeason();
  const cards = tokens.map((t) => { const c = scoreCard(t, wk.teamScores, prevAll[t.id]); c.PFP = pfps[String(c.OwnerId).toLowerCase()] || { ImageUrl: '', NftContract: '', DisplayName: '' }; return c; });
  // ranks: weekly overall (Rank), season overall, league standing by season (LeagueRank)
  // competition ranking: ties share the rank (pre-kickoff everyone is #1, not an arbitrary 1..N)
  const rankBy = (arr, key, tieKey, out) => {
    arr.sort((a, b) => b[key] - a[key] || b[tieKey] - a[tieKey]);
    let rank = 0;
    arr.forEach((c, i) => { if (i === 0 || c[key] !== arr[i - 1][key] || c[tieKey] !== arr[i - 1][tieKey]) rank = i + 1; c[out] = rank; });
    return arr;
  };
  const byWeek = rankBy([...cards], 'ScoreWeek', 'ScoreSeason', '_rank');
  const byLeague = {};
  for (const c of cards) (byLeague[c.Card.LeagueId] ||= []).push(c);
  for (const arr of Object.values(byLeague)) rankBy(arr, 'ScoreSeason', 'ScoreWeek', '_leagueRank');
  log(`cards scored: ${cards.length} in ${Object.keys(byLeague).length} leagues; top week: ${byWeek.slice(0, 3).map((c) => `${c.CardId}=${c.ScoreWeek}`).join(', ')}`);

  // change detection
  const lastF = join(STATE_DIR, `last-${GW}.json`);
  const last = !SEED && existsSync(lastF) ? JSON.parse(readFileSync(lastF, 'utf8')) : {};
  const next = {}; let changed = 0;
  const writer = db.bulkWriter();
  let notFound = 0, failed = 0;
  const failedCards = new Set(); // cardIds with a write that gave up — retried next pass
  writer.onWriteError((err) => {
    if (err.code === 5 /* NOT_FOUND */) { notFound++; return false; }
    if (err.failedAttempts < 3) return true;
    failed++; failedCards.add(String(err.documentRef?.path || '').split('/').pop()); return false;
  });
  const w = (promise) => promise.catch(() => {}); // rejections are counted in onWriteError; never crash the pass
  for (const c of cards) {
    const sig = `${c.ScoreWeek}|${c.ScoreSeason}|${c._rank}|${c._leagueRank}`;
    next[c.CardId] = sig;
    if (last[c.CardId] === sig) continue;
    changed++;
    if (!APPLY) continue;
    const { _rank, _leagueRank, ...doc } = c;
    w(writer.set(db.doc(`draftTokenLeaderboard/${GW}/cards/${c.CardId}`), doc));
    w(writer.set(db.doc(`drafts/${c.Card.LeagueId}/scores/${GW}/cards/${c.CardId}`), doc));
    const tokenPatch = { Rank: String(_rank), LeagueRank: String(_leagueRank), WeekScore: String(c.ScoreWeek), SeasonScore: String(c.ScoreSeason) };
    w(writer.update(db.doc(`draftTokens/${c.CardId}`), tokenPatch));
    if (c.OwnerId) w(writer.update(db.doc(`owners/${c.OwnerId}/usedDraftTokens/${c.CardId}`), tokenPatch));
    w(writer.update(db.doc(`drafts/${c.Card.LeagueId}/cards/${c.CardId}`), tokenPatch));
  }
  if (APPLY) {
    await writer.close();
    for (const id of failedCards) delete next[id]; // no signature → rewritten on the next pass
    writeFileSync(lastF, JSON.stringify(next));
    await db.collection('cron_heartbeats').doc('espn-scorer').set({ at: new Date().toISOString(), gameweek: GW, games: wk.games.length, live, final: done, cards: cards.length, changed });
  }
  log(`cards changed: ${changed}${APPLY ? ` (written; missing-doc skips ${notFound}, failed ${failed})` : ' (dry)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('SCORER FAILED', e); process.exit(1); });
