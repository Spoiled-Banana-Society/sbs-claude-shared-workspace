// Jackpot #56 (2025-slow-draft-50) heal, step 1 of 2 (2026-09-03):
// backfill A_Pevine's missing pick-85 DAL-TE into state/rosters. The draft
// summary (150/150, no dupes) is the source of truth — his roster store has
// 14/15 because the 8/27 pointer heal never backfilled the healed pick.
// Guarded: refuses to run twice or against an unexpected roster size.
import fs from 'fs';
import admin from 'firebase-admin';
const m = fs.readFileSync(new URL('./lib/firebaseAdmin.ts', import.meta.url), 'utf8')
  .match(/STAGING_SA_B64\s*=\s*'([^']+)'/);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const PEV = '0x7fc55376d5a29e0ee86c18c81bb2fc8f9f490e50';
await db.runTransaction(async (tx) => {
  const ref = db.doc('drafts/2025-slow-draft-50/state/rosters');
  const d = (await tx.get(ref)).data();
  const key = d.Rosters ? 'Rosters' : 'rosters';
  const roster = d[key][PEV];
  if (roster.TE.some((t) => t.PlayerId === 'DAL-TE')) throw new Error('already present — nothing to do');
  const total = ['DST', 'QB', 'RB', 'TE', 'WR'].reduce((s, k) => s + roster[k].length, 0);
  if (total !== 14) throw new Error('unexpected roster size ' + total + ' — aborting');
  roster.TE.unshift({ Team: 'DAL', PlayerId: 'DAL-TE', DisplayName: 'DAL-TE' });
  tx.set(ref, d);
});
const check = (await db.doc('drafts/2025-slow-draft-50/state/rosters').get()).data();
const r2 = (check.Rosters || check.rosters)[PEV];
const n = ['DST', 'QB', 'RB', 'TE', 'WR'].reduce((s, k) => s + r2[k].length, 0);
console.log('pevine roster now:', n, 'picks | TE:', JSON.stringify(r2.TE.map((t) => t.PlayerId)));
console.log(n === 15 ? 'STEP 1 DONE — tell Claude' : 'UNEXPECTED — tell Claude before doing anything else');
process.exit(0);
