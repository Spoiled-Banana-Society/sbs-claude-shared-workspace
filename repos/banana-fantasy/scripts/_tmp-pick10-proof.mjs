import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();
const p = await db.collection('v2_users').doc('0xeab34d772d0fc63cd89b58772de0c1cfaebdc7d4').collection('promos').doc('2').get();
const d = p.data();
console.log('slot-10 pick-10 promo:', JSON.stringify({ claimCount: d.claimCount, history: (d.modalContent?.pick10History ?? []).map(h => h.draftName) }));
