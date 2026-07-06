#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const raw = line.slice(line.indexOf('{'), line.lastIndexOf('}')+1);
const sa = JSON.parse(raw);
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const all = await db.collection('v2_users').get();
console.log('total users:', all.size);
const hits = [];
all.forEach(s => {
  const d = s.data();
  if (/silky/i.test(JSON.stringify({u:d.username,dn:d.displayName,n:d.name,e:d.email||''}))) hits.push({ id: s.id, ...d });
});
console.log(`matches: ${hits.length}`);
for (const h of hits) {
  console.log('\n=== wallet:', h.id);
  for (const [k,v] of Object.entries(h)) {
    if (k === 'id') continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`  ${k} = ${s.length > 300 ? s.slice(0,300)+'…' : s}`);
  }
}
