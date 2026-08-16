// Wipe stale rosters (from voided draft 639) off the 9 refunded tokens so the
// drafting page stops hiding their new draft rows (rosterCount>=15 => hidden).
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const TOKENS = { '8084':'0x690014bea1c7506cd221eee73b18db33f5241db3','8091':'0x32ffd97f914baa03caca2af98919c3eaf91070c3','7821':'0xa38596a0280de3f23afbb8a4315108a7e50546fe','8109':'0x84c41f5ad4ce804bc42b9f52b48380a9077076aa','8116':'0x912e0a28931c2c263b12bc7b9e3be77cf4ad9d4f','8117':'0x7fc55376d5a29e0ee86c18c81bb2fc8f9f490e50','8082':'0x696012486d4629baa75e0f44a481f127f6705e1e','6954':'0x09c1f3e6ae1918b7d275e1ef4de1b3aeba674a4b','8058':'0x3775f0134d6ef7166dccc453160b928fcc23d87f' };
const RESET = { Roster: { QB: null, RB: null, WR: null, TE: null, DST: null }, Rank: 'N/A', WeekScore: '0', SeasonScore: '0', LeagueRank: '', Prizes: { ETH: 0 } };
for (const [id, owner] of Object.entries(TOKENS)) {
  const tokRef = db.doc(`draftTokens/${id}`);
  const tok = (await tokRef.get()).data();
  const league = tok?.LeagueId || '';
  const targets = [tokRef, db.doc(`owners/${owner}/validDraftTokens/${id}`), db.doc(`owners/${owner}/usedDraftTokens/${id}`)];
  if (league) targets.push(db.doc(`drafts/${league}/cards/${id}`));
  const batch = db.batch();
  let n = 0;
  for (const ref of targets) { if ((await ref.get()).exists) { batch.set(ref, RESET, { merge: true }); n++; } }
  await batch.commit();
  const after = (await tokRef.get()).data();
  const cnt = Object.values(after.Roster||{}).reduce((a,v)=>a+((v||[]).length),0);
  console.log(`${id} owner=${owner.slice(0,8)} league=${league||'-'} docs_reset=${n} rosterCount_after=${cnt}`);
}
process.exit(0);
