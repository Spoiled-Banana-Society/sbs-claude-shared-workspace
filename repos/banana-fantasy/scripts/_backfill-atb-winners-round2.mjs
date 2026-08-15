/**
 * ONE-OFF (2026-08-14, Richard): round-one ATB winners CAN win again in round
 * two. The 8/13 lobby-two reset kept their atbCompletedAt, which blocks the
 * 10/10 win branch from ever re-firing. Clear atbCompletedAt +
 * atbCompletedDraftName for seats 1-10 ONLY (atbWonAt/atbSeatNumber kept —
 * their card still shows the seat they won). Run AFTER the round-scoped
 * repeat-guard deploy, never before (old code would stamp completedAt back
 * with no seat). Idempotent — skips docs already cleared.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/richardvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const state = await db.collection('around_the_banana').doc('state').get();
const winners = (state.data()?.winners ?? []).filter((w) => w.seat <= 10);
console.log(`round-one winners: ${winners.length}`);
for (const w of winners) {
  const ref = db.collection('v2_users').doc(w.userId).collection('promos').doc('around-the-banana');
  const snap = await ref.get();
  const mc = snap.data()?.modalContent ?? {};
  if (!mc.atbCompletedAt) { console.log(`  seat ${w.seat} ${w.userId} already clear, skip`); continue; }
  await ref.update({
    'modalContent.atbCompletedAt': FieldValue.delete(),
    'modalContent.atbCompletedDraftName': FieldValue.delete(),
  });
  console.log(`  seat ${w.seat} ${w.userId} cleared (slots now ${JSON.stringify(mc.atbSlotsHit ?? [])}, wonAt kept ${mc.atbWonAt})`);
}
console.log('done');
