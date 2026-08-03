/**
 * Stamp the origin on JackHOF Draft #22 (2025-slow-draft-22).
 *
 * The league's seats came from the Banana Draw (4 grants) and the Eliminator
 * (2 grants), not from the wheel — but the engine hard-coded "(from Wheel)"
 * into every special draft's name at fill. Go rev 00191 reads the origin off
 * the league doc instead; this stamps the one league that predates the field.
 * Every other special was a genuine wheel win, and an absent field already
 * reads as "wheel", so nothing else needs touching.
 *
 * Effect at fill: "JackHOF #28 (from Promo)". The NUMBER is untouched — it
 * still comes from the shared SpecialDraftCount sequence.
 *
 * Dry-run by default; pass --commit to write. Also the reversal reference:
 * setting Source back to 'wheel' (or deleting it) restores the old name.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const COMMIT = process.argv.includes('--commit');
const DRAFT_ID = '2025-slow-draft-22';
const SOURCE = 'promo';

const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const b64 = src.match(/STAGING_SA_B64 = '([^']+)'/)[1];
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))),
});
const db = admin.firestore();

const ref = db.collection('drafts').doc(DRAFT_ID);
const snap = await ref.get();
if (!snap.exists) {
  console.error(`ABORT: ${DRAFT_ID} does not exist`);
  process.exit(1);
}
const d = snap.data();

// Seats lock at fill and the name is written in the same breath, so a started
// draft is past the point this can help — renaming it would need the token
// name copies rewritten too. Refuse rather than half-apply.
const info = await ref.collection('state').doc('info').get();
if (info.exists) {
  console.error(`ABORT: ${DRAFT_ID} has already STARTED (state/info exists) — the name is set; this is now a hand-rename, not a stamp`);
  process.exit(1);
}

console.log(`${DRAFT_ID}`);
console.log(`  Level        : ${d.Level}`);
console.log(`  DisplayName  : ${d.DisplayName}`);
console.log(`  NumPlayers   : ${d.NumPlayers}/${d.MaxPlayers}`);
console.log(`  Source (now) : ${d.Source ?? '(unset → reads as wheel)'}`);
console.log(`  Source (new) : ${SOURCE}`);
console.log(`  name at fill : ${d.Level} #<SpecialDraftCount> (from ${SOURCE === 'promo' ? 'Promo' : 'Wheel'})`);

if (d.Source === SOURCE) {
  console.log('\nAlready stamped — nothing to do.');
  process.exit(0);
}

if (!COMMIT) {
  console.log('\nDRY RUN — re-run with --commit to write.');
  process.exit(0);
}

// update(), not set(): one field, and the league doc holds CurrentUsers and the
// seat bookkeeping that a full write could clobber.
await ref.update({ Source: SOURCE });
const after = (await ref.get()).data();
console.log(`\nWROTE. Source is now: ${after.Source}`);
process.exit(0);
