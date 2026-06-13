#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const show = (label, d) => console.log(`\n[${label}]`, d.exists ? JSON.stringify(d.data(), (k,v)=> Array.isArray(v)&&v.length>8?`<array len ${v.length}>`:v, 1).slice(0,900) : 'MISSING');
show('system_config/batchProof', await db.collection('system_config').doc('batchProof').get());
show('system_config/batchProofMerkle', await db.collection('system_config').doc('batchProofMerkle').get());
show('system_config/merkleRoundState', await db.collection('system_config').doc('merkleRoundState').get());
const mr = await db.collection('merkle_rounds').get();
console.log(`\n[merkle_rounds] ${mr.size} docs:`);
for (const d of mr.docs) { const x=d.data(); console.log(`  round ${d.id}: roundNumber=${x.roundNumber} leaves=${x.merkleLeaves?.length??'?'} committed=${x.committedOnchain??x.committed??'?'} revealed=${x.revealedCount??x.consumed??'?'} root=${(x.merkleRoot||'').slice(0,14)}`); }
process.exit(0);
