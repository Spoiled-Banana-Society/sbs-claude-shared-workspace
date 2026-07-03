// Offline simulation of the onBotTurn v1 pick logic using the REAL playerMap.
// 10 bots snake-draft 15 rounds; prints pick delays, sample teams, cap checks.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const pm = await db.collection('playerStats2026').doc('playerMap').get();
const players = pm.data().Players;

const cfg = { topN: 5, positionCaps: { QB: 3, RB: 7, WR: 8, TE: 3 } };
const posOf = (id) => (String(id).split('-')[1] || '').replace(/\d+$/, '');

function brainPick(taken, mine) {
  let available = Object.keys(players)
    .filter((id) => !taken.has(id))
    .map((id) => ({ id, adp: Number(players[id].ADP) || 999 }))
    .sort((a, b) => a.adp - b.adp);
  const underCap = available.filter((s) => (mine[posOf(s.id)] ?? 0) < (cfg.positionCaps[posOf(s.id)] ?? 99));
  if (underCap.length > 0) available = underCap;
  const pool = available.slice(0, cfg.topN);
  const weights = pool.map((_, i) => Math.pow(0.55, i));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) { chosen = pool[i]; break; } }
  return chosen;
}

const taken = new Set();
const rosters = Array.from({ length: 10 }, () => ({}));
const order = [...Array(10).keys()];
const picksLog = [];
for (let round = 0; round < 15; round++) {
  const seq = round % 2 === 0 ? order : [...order].reverse();
  for (const slot of seq) {
    const mine = rosters[slot];
    const pick = brainPick(taken, mine);
    taken.add(pick.id);
    const pos = posOf(pick.id);
    mine[pos] = (mine[pos] ?? 0) + 1;
    picksLog.push({ round: round + 1, slot: slot + 1, id: pick.id, adp: pick.adp });
  }
}
console.log('total picks:', picksLog.length, '(expect 150, all unique:', taken.size === 150, ')');
console.log('\nRound 1 picks (should hug ADP 1-15):');
console.log(picksLog.slice(0, 10).map(p => `${p.id}(adp${p.adp})`).join(' '));
console.log('\nTeam built by drafter #1 and #10:');
for (const s of [0, 9]) {
  const t = picksLog.filter(p => p.slot === s + 1).map(p => `${p.id}`);
  console.log(`slot ${s + 1}:`, t.join(', '));
  console.log('  position counts:', JSON.stringify(rosters[s]));
}
const capViolations = rosters.filter(r => (r.QB ?? 0) > 3 || (r.TE ?? 0) > 3 || (r.RB ?? 0) > 7 || (r.WR ?? 0) > 8).length;
console.log('\nrosters violating caps:', capViolations);
// delay distribution sanity
const delays = Array.from({ length: 20 }, () => Math.round(10 + Math.random() * 20));
console.log('sample fast-draft delays (10-30s):', delays.join(', '));
