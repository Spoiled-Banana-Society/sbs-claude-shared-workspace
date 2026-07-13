#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const cols = await db.listCollections();
console.log('ALL top-level collections + sizes:');
const rows = [];
for (const c of cols) {
  const n = (await c.count().get()).data().count;
  rows.push([c.id, n]);
}
rows.sort((a,b)=>b[1]-a[1]);
for (const [id,n] of rows) console.log(`  ${String(n).padStart(7)}  ${id}`);
// peek v2_queues structure
console.log('\nv2_queues docs:');
const q = await db.collection('v2_queues').get();
for (const d of q.docs) {
  const data = d.data();
  const rounds = data.rounds || [];
  const filling = rounds.filter(r=>r.status==='filling');
  const members = rounds.reduce((s,r)=>s+(r.members?.length||0),0);
  console.log(`  ${d.id}: ${rounds.length} rounds (${filling.length} filling), ${members} total members`);
}
process.exit(0);
