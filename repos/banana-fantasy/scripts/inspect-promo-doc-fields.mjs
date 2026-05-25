import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

const pg = await db.collectionGroup('promos').limit(50000).get();

// Field-shape census: which fields exist per promo type
const byType = {};
for (const doc of pg.docs) {
  const data = doc.data();
  const t = String(data.type ?? '?');
  if (!byType[t]) byType[t] = { count: 0, fields: new Map(), samples: [] };
  byType[t].count += 1;
  for (const k of Object.keys(data)) {
    if (!byType[t].fields.has(k)) byType[t].fields.set(k, 0);
    byType[t].fields.set(k, byType[t].fields.get(k) + 1);
  }
  if (byType[t].samples.length < 1) byType[t].samples.push(data);
}

for (const [t, info] of Object.entries(byType)) {
  console.log(`\n=== ${t} (${info.count} docs) ===`);
  console.log('Fields present:');
  for (const [k, n] of [...info.fields.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} present in ${n}/${info.count}`);
  }
  console.log('Sample doc:');
  console.log(`  ${JSON.stringify(info.samples[0]).slice(0, 400)}`);
}
