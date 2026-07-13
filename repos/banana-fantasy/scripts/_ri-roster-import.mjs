// One-time: rewrite playerStats2026 rosters from the FRESH Rolling Insights feed
// using RI's (now-correct) depth ORDER directly — NO carryover (which was burying
// real 2026 moves like A.J. Brown->NE) — plus two name fixes RI still has wrong:
//   TEN QB: "Jihad Ward" -> "Cam Ward"   |   PHI WR: "Devin Smith" -> "DeVonta Smith"
// Updates ONLY PlayersFromTeam (ByeWeek/ADP/PlayerId untouched). Dry-run unless --write.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const WRITE = process.argv.includes('--write');

const ri = JSON.parse(readFileSync('/Users/richardvagner/sbs-2026-rollover/ri_depthcharts_check.json', 'utf8')).data.NFL;
const FULL2AB = {
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF',
  'Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE',
  'Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
  'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC',
  'Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Las Vegas Raiders':'LV','Miami Dolphins':'MIA',
  'Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
  'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','Seattle Seahawks':'SEA',
  'San Francisco 49ers':'SF','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS',
};
const ROMAN = /\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
const clean = (n) => String(n).replace(ROMAN, '').trim();
const flatten = (m) => m ? Object.keys(m).sort((a, b) => +a - +b).map((k) => clean(m[k].player)) : [];

// Scoped name fixes for RI's known-wrong entries (team|base -> {bad:good}).
const NAME_FIX = { 'TEN|QB': { 'Jihad Ward': 'Cam Ward' }, 'PHI|WR': { 'Devin Smith': 'DeVonta Smith' } };
const applyFix = (ab, base, list) => {
  const fix = NAME_FIX[`${ab}|${base}`];
  return fix ? list.map((n) => fix[n] || n) : list;
};

const roster = {};
for (const [full, pos] of Object.entries(ri)) {
  const ab = FULL2AB[full]; if (!ab) continue;
  const wr1 = flatten(pos.WR1), wr2 = flatten(pos.WR2), wr3 = flatten(pos.WR3);
  const wr = [];
  for (let i = 0, d = Math.max(wr1.length, wr2.length, wr3.length); i < d; i++)
    for (const col of [wr1, wr2, wr3]) if (i < col.length) wr.push(col[i]);
  roster[ab] = {
    QB: applyFix(ab, 'QB', flatten(pos.QB)),
    RB: applyFix(ab, 'RB', flatten(pos.RB)),
    TE: applyFix(ab, 'TE', flatten(pos.TE)),
    WR: applyFix(ab, 'WR', wr),
  };
}

const baseOf = (slot) => ({ RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR' }[slot] || slot);
const ref = db.collection('playerStats2026').doc('playerMap');
const snap = await ref.get();
const data = snap.data();
const players = data.Players;
let changed = 0; const samples = [];
const SHOW = ['TEN-QB','PHI-WR1','NE-WR1','ARI-RB1','KC-QB','SF-TE','KC-RB1','MIA-QB','BAL-RB1','CIN-WR1'];
for (const [pid, entry] of Object.entries(players)) {
  const dash = pid.indexOf('-');
  const team = pid.slice(0, dash), slot = pid.slice(dash + 1);
  if (slot === 'DST') continue;
  const list = roster[team]?.[baseOf(slot)] || [];
  entry.PlayersFromTeam = list;
  changed++;
  if (SHOW.includes(pid)) samples.push([pid, list.slice(0, 4)]);
}
console.log('rosters updated:', changed);
for (const [pid, l] of samples) console.log(' ', pid.padEnd(9), JSON.stringify(l));
if (WRITE) { await ref.set(data); console.log('\nWROTE playerStats2026/playerMap'); }
else console.log('\nDRY RUN — pass --write to apply');
process.exit(0);
