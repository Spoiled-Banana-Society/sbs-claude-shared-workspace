import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const cfg = await fs.collection('config').doc('wheel').get();
console.log('config/wheel exists:', cfg.exists);
if (cfg.exists) {
  const segs = cfg.get('segments') || [];
  console.log('segments:', segs.map(s => `${s.id}:${s.probability}`).join(' '));
}
process.exit(0);
