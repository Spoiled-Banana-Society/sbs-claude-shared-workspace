// Offline simulation of the onBotTurn brain (Richard's normal-drafter blueprint)
// vs the REAL playerMap ADP. 10 bots, 15-round snake. Mirrors the CF logic.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const pm = await db.collection('playerStats2026').doc('playerMap').get();
const players = pm.data().Players;

const typeOf = (id) => String(id).split('-')[1] || '';
function drawTeamBlueprint(rand) {
  for (let tries = 0; tries < 60; tries++) {
    const t = {
      QB: rand() < 0.6 ? 2 : 3, RB1: rand() < 0.5 ? 3 : 4, WR1: rand() < 0.45 ? 3 : 4,
      TE: rand() < 0.6 ? 2 : 3, DST: rand() < 0.7 ? 2 : 3, RB2: 0, WR2: 0,
    };
    const rem = 15 - (t.QB + t.RB1 + t.WR1 + t.TE + t.DST);
    if (rem < 0 || rem > 2) continue;
    if (rem === 2) { t.WR2 = 1; t.RB2 = 1; }
    else if (rem === 1) { if (t.RB1 === 3 && rand() < 0.3) t.RB2 = 1; else t.WR2 = 1; }
    return t;
  }
  return { QB: 3, RB1: 4, WR1: 4, TE: 2, DST: 2, RB2: 0, WR2: 0 };
}
function brainPick(taken, mine, targets, topN = 5) {
  let available = Object.keys(players).filter((id) => !taken.has(id))
    .map((id) => ({ id, adp: Number(players[id].ADP) || 999 })).sort((a, b) => a.adp - b.adp);
  const needed = available.filter((s) => {
    const t = typeOf(s.id);
    if ((mine[t] ?? 0) >= (targets[t] ?? 0)) return false;
    if (t === 'RB2' && (mine.RB1 ?? 0) < 2) return false;
    if (t === 'WR2' && (mine.WR1 ?? 0) < 2) return false;
    return true;
  });
  if (needed.length > 0) available = needed;
  if (!available.length) return null;
  const pool = available.slice(0, topN);
  const w = pool.map((_, i) => Math.pow(0.55, i));
  let roll = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { roll -= w[i]; if (roll <= 0) return pool[i]; }
  return pool[0];
}

// blueprint distribution over 2000 draws
const dist = {};
for (let i = 0; i < 2000; i++) {
  const t = drawTeamBlueprint(Math.random);
  const sum = Object.values(t).reduce((a, b) => a + b, 0);
  if (sum !== 15) { console.log('BAD SUM', t); process.exit(1); }
  const key = `QB${t.QB} RB1x${t.RB1} WR1x${t.WR1} TE${t.TE} DST${t.DST} RB2x${t.RB2} WR2x${t.WR2}`;
  dist[key] = (dist[key] || 0) + 1;
}
console.log('all 2000 blueprints sum to 15 ✓  distinct shapes:', Object.keys(dist).length);
const wr2 = Object.entries(dist).filter(([k]) => k.includes('WR2x1')).reduce((a, [, n]) => a + n, 0);
const rb2 = Object.entries(dist).filter(([k]) => k.includes('RB2x1')).reduce((a, [, n]) => a + n, 0);
console.log(`teams w/ WR2: ${(wr2 / 20).toFixed(0)}%  teams w/ RB2: ${(rb2 / 20).toFixed(0)}% (WR2 should be higher)`);

// one full draft
const taken = new Set();
const rosters = Array.from({ length: 10 }, () => ({}));
const plans = Array.from({ length: 10 }, () => drawTeamBlueprint(Math.random));
const teams = Array.from({ length: 10 }, () => []);
const order = [...Array(10).keys()];
for (let r = 0; r < 15; r++) {
  for (const seat of r % 2 === 0 ? order : [...order].reverse()) {
    const p = brainPick(taken, rosters[seat], plans[seat]);
    if (!p) continue;
    taken.add(p.id);
    rosters[seat][typeOf(p.id)] = (rosters[seat][typeOf(p.id)] ?? 0) + 1;
    teams[seat].push(p.id);
  }
}
console.log('\nfull draft: picks =', taken.size, '(expect 150)');
for (const s of [0, 4, 9]) {
  console.log(`seat ${s + 1} plan`, JSON.stringify(plans[s]), '→ built', JSON.stringify(rosters[s]));
  console.log('   ', teams[s].join(', '));
}
