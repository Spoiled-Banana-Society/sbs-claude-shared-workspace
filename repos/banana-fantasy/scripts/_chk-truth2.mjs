import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
for (const id of ['994','161','359']) {
  const m = await fs.collection('draftTokenMetadata').doc(id).get();
  if (!m.exists) { console.log(`\n${id}: NO draftTokenMetadata`); continue; }
  const d = m.data();
  console.log(`\n===== ${id} =====`);
  console.log('Name:', d.Name);
  console.log('Image:', String(d.Image).slice(0,80));
  const attrs = (d.Attributes||[]).map(a=>`${a.Trait_Type||a.trait_type}=${a.Value||a.value}`);
  console.log('Attributes:', JSON.stringify(attrs));
}
process.exit(0);
