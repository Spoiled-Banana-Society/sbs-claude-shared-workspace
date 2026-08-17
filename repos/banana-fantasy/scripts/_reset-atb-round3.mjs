/**
 * ONE-OFF (2026-08-17, Boris): Around The Banana ROUND THREE relaunch. Every
 * racer starts from a clean 0/10 lap — same reset resetAllLapsForLobbyTwo ran
 * on 8/13 for round two, PLUS the 8/14 backfill folded in (atbCompletedAt
 * cleared for EVERYONE incl. prior winners — winners can win again, Richard
 * 2026-08-14). Keeps atbSeenDraftIds (old drafts never re-credit) and every
 * winner's atbWonAt/atbSeatNumber (their card keeps "Won Seat N").
 * Marker-guarded on around_the_banana/state (lobbyThreeResetAt) — runs once.
 * MUST run BEFORE the relaunch deploy (crediting is off until then).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const DRY = process.argv.includes('--dry');

const stateRef = db.collection('around_the_banana').doc('state');
const st = (await stateRef.get()).data() ?? {};
console.log('winners', (st.winners ?? []).length, 'lobbyTwoResetAt', st.lobbyTwoResetAt, 'lobbyThreeResetAt', st.lobbyThreeResetAt);
if (st.lobbyThreeResetAt && !DRY) { console.log('already reset — exit'); process.exit(0); }
if ((st.winners ?? []).length !== 20) throw new Error('expected exactly 20 winners before round three');

const snap = await db.collectionGroup('promos').get();
let cleared = 0, scanned = 0;
for (const d of snap.docs) {
  if (d.id !== 'around-the-banana') continue;
  scanned++;
  const mc = d.data().modalContent ?? {};
  const hasProgress = Array.isArray(mc.atbSlotsHit) && mc.atbSlotsHit.length > 0;
  if (!hasProgress && !mc.atbCompletedAt && !(d.data().progressCurrent > 0)) continue;
  const update = {
    progressCurrent: 0,
    'modalContent.atbSlotsHit': [],
    'modalContent.atbCompletedAt': FieldValue.delete(),
    'modalContent.atbCompletedDraftName': FieldValue.delete(),
  };
  if (!DRY) await d.ref.update(update);
  cleared++;
}
console.log(`scanned ${scanned} ATB docs, ${DRY ? 'would clear' : 'cleared'} ${cleared}`);
if (!DRY) await stateRef.set({ lobbyThreeResetAt: new Date().toISOString() }, { merge: true });
console.log(DRY ? 'DRY RUN done' : 'done');
process.exit(0);
