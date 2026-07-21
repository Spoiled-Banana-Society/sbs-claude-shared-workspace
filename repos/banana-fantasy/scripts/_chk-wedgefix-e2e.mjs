// Consistency proof for the atomic-join fix: every seat in the draft must have
// token bound + usedDraftTokens + cards copy + NO spendable pass.
import admin from 'firebase-admin';
import fs from 'fs';
const src = fs.readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const L = process.argv[2] || '2026-fast-draft-196';
const draft = (await db.collection('drafts').doc(L).get()).data();
let bad = 0;
for (const u of draft.CurrentUsers || []) {
  const w = String(u.OwnerId).toLowerCase();
  const id = String(u.TokenId);
  const tok = (await db.collection('draftTokens').doc(id).get()).data();
  const used = (await db.collection(`owners/${w}/usedDraftTokens`).doc(id).get()).exists;
  const card = (await db.collection(`drafts/${L}/cards`).doc(id).get()).exists;
  const valid = (await db.collection(`owners/${w}/validDraftTokens`).doc(id).get()).exists;
  const bound = tok && tok.LeagueId === L;
  const ok = bound && used && card && !valid;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${w.slice(0, 10)} token ${id} bound=${!!bound} used=${used} card=${card} spendableLeft=${valid}`);
}
console.log(bad === 0 ? `\nALL ${draft.CurrentUsers.length} SEATS CONSISTENT` : `\n${bad} INCONSISTENT`);
process.exit(0);
