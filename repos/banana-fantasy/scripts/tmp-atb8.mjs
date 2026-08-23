import admin from 'firebase-admin';
import fs from 'fs';
const src = fs.readFileSync('lib/firebaseAdmin.ts','utf8');
const m = src.match(/['"]([A-Za-z0-9+/=]{200,})['"]/);
const sa = JSON.parse(Buffer.from((process.env.STAGING_SA_B64||m[1]),'base64').toString());
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
for (const id of ['2026-fast-draft-726','2026-fast-draft-730']) {
  const ev = await db.collection('v2_activity_events').where('metadata.draftId','==',id).limit(20).get();
  const rows = ev.docs.filter(d=>d.data().type==='draft_filled').map(d=>({w:d.data().walletAddress.toLowerCase(), name:d.data().username, pass:d.data().metadata?.passType}));
  console.log(`=== ${id} (${rows.length} drafters)`);
  for (const r of rows) {
    const u = (await db.doc(`v2_users/${r.w}`).get()).data()||{};
    const promos = await db.collection(`v2_users/${r.w}/promos`).limit(2).get();
    const atb = (await db.doc(`v2_users/${r.w}/promos/around-the-banana`).get()).data();
    const seen = atb?.modalContent?.atbSeenDraftIds || [];
    console.log(' ', r.w.slice(0,12), String(r.name||u.username||'?').padEnd(16), 'pass:', String(r.pass).padEnd(5), 'bot:', !!(u.isBot||u.isHouseBot||u.houseBot), 'promoDocs:', promos.size>0, 'atbDoc:', !!atb, 'counted:', seen.includes(id), 'prog:', atb?.progressCurrent ?? '-');
  }
}
process.exit(0);
