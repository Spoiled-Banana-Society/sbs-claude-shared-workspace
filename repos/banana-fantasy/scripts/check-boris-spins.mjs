import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

const BORIS = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
// Activity events 'spin_won' for Boris
const sw = await db.collection('v2_activity_events').where('userId', '==', BORIS).where('type', '==', 'spin_won').limit(50000).get();
console.log(`Activity spin_won for Boris: ${sw.size}`);

// Subcollection wheelSpins for Boris
const ws = await db.collection('v2_users').doc(BORIS).collection('wheelSpins').limit(50000).get();
console.log(`Subcollection wheelSpins for Boris: ${ws.size}`);

// All Boris's activity events
const all = await db.collection('v2_activity_events').where('userId', '==', BORIS).limit(50000).get();
const byType = {};
for (const d of all.docs) byType[d.data().type ?? '?'] = (byType[d.data().type ?? '?'] ?? 0) + 1;
console.log('Boris activity by type:', byType);
