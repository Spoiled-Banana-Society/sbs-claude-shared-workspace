import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W = process.argv[2] || '0x696012486d4629baa75e0f44a481f127f6705e1e';
const GO = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const used = await db.collection(`owners/${W}/usedDraftTokens`).get();
const valid = await db.collection(`owners/${W}/validDraftTokens`).get();
console.log('used', used.size, 'valid', valid.size);
const rows = [];
for (const d of used.docs) {
  const t = d.data();
  const league = t.LeagueId || t.leagueId || '';
  const cnt = Object.values(t.Roster||{}).reduce((a,v)=>a+((v||[]).length),0);
  let info = null, dl = null;
  if (league) {
    dl = (await db.doc(`drafts/${league}`).get()).data();
    try { const r = await fetch(`${GO}/draft/${league}/state/info`); info = r.ok ? await r.json() : { status: r.status, text: (await r.text()).slice(0,80) }; } catch(e){ info={err:String(e)}; }
  }
  rows.push({ id: d.id, league, name: dl?.DisplayName, np: dl?.NumPlayers, locked: dl?.IsLocked, rosterCnt: cnt, pass: t.PassType||t.passType, pick: info?.pickNumber, drafter: info?.currentDrafter, st: info?.status, pickStart: info?.currentPickStartTime || info?.pickStartTime });
}
rows.sort((a,b)=>String(a.league).localeCompare(String(b.league)));
for (const r of rows) console.log(JSON.stringify(r));
console.log('--- valid tokens (unused) roster counts:');
for (const d of valid.docs) { const t=d.data(); const cnt = Object.values(t.Roster||{}).reduce((a,v)=>a+((v||[]).length),0); console.log(d.id, 'league=', t.LeagueId||'-', 'roster=', cnt, t.PassType); }
process.exit(0);
