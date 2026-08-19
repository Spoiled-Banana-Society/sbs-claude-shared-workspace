import admin from 'firebase-admin';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
setTimeout(()=>process.exit(0),60000);
for (const w of ['0x466d16ec1724f08aaeec2399816160f0d95d9d4f','0xa551f64ae2791d0fc6c8cad23c22ac3529dbbd2e']) {
  const u=(await db.collection('v2_users').doc(w).get()).data()||{};
  const p=(await db.collection('v2_users').doc(w).collection('promos').doc('around-the-banana').get()).data()||{};
  const mc=p.modalContent||{};
  console.log('==', u.username, w.slice(0,10), 'slotsHit', JSON.stringify(mc.atbSlotsHit), 'wonAt', mc.atbWonAt, 'seat', mc.atbSeatNumber, 'seen', (mc.atbSeenDraftIds||[]).length);
  console.log('   last seen:', (mc.atbSeenDraftIds||[]).slice(-8).join(', '));
}
process.exit(0);
