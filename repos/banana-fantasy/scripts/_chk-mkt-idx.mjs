import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
for (const id of ['994','161','359']) {
  const d = await fs.collection('marketplace_index').doc(id).get();
  console.log(`doc('${id}') exists=${d.exists}`, d.exists ? JSON.stringify({status:d.data().status, level:d.data().level, leagueNumber:d.data().leagueNumber, hasImg:!!d.data().image, tokenId:d.data().tokenId}) : '');
}
// Find the doc whose tokenId field == 994
const q = await fs.collection('marketplace_index').where('tokenId','==','994').get();
console.log(`\nwhere tokenId==994: ${q.size} docs`);
q.forEach(d => console.log(`  docKey='${d.id}' status=${d.data().status} level=${d.data().level}`));
process.exit(0);
