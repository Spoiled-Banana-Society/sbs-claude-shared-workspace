// Manual pick-advance for 2026-slow-draft-71 (BBB #610): pick 93 fully recorded
// in summary+rosters+playerState; engine died before the RTDB advance. This
// writes EXACTLY what ProcessNewPick's advance block would have written.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('./lib/firebaseAdmin.ts','utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rt = admin.database();
const ID='2026-slow-draft-71';
const NEXT='0x32ffd97f914baa03caca2af98919c3eaf91070c3';
const ONDECK='0x4cb8a72d3456ff8124285869270af99598371b7c';
const PICKED='0xeffc7bb82b1495b9b14394ff891d1e14e1f17c8f';
const now = Math.floor(Date.now()/1000);

const info = (await rt.ref(`drafts/${ID}/realTimeDraftInfo`).get()).val();
if (info.pickNumber !== 93 || (info.currentDrafter||'').toLowerCase() !== PICKED) {
  console.log('ABORT — state changed:', JSON.stringify({pick:info.pickNumber, curr:info.currentDrafter})); process.exit(1);
}
await rt.ref(`drafts/${ID}/realTimeDraftInfo`).update({
  pickNumber: 94,
  pickInRound: 4,
  roundNum: 10,
  currentDrafter: NEXT,
  onDeckDrafter: ONDECK,
  pickStartTime: now,
  pickEndTime: now + 28800,
  lastPick: { displayName:'KC-TE', ownerAddress:PICKED, pickNum:93, playerId:'KC-TE', position:'TE', round:10, team:'KC' },
});
console.log('RTDB advanced to pick 94, clock ends', new Date((now+28800)*1000).toISOString());

await db.runTransaction(async (tx) => {
  const ref = db.collection('drafts').doc(ID);
  const d = (await tx.get(ref)).data();
  if ((d.CurrentPickNumber ?? 93) > 94) throw new Error('firestore ahead — abort');
  tx.update(ref, { CurrentPickNumber: 94, CurrentRound: 10, PickInRound: 4, CurrentDrafter: NEXT });
});
console.log('Firestore counters synced');
