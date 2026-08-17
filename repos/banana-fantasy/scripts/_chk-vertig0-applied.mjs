import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W = '0x696012486d4629baa75e0f44a481f127f6705e1e';
const s = await db.collection('v2_debug_events').where('wallet','==',W).where('tag','==','lobby-pick').get();
const c = {}; let first='9', last='';
for (const d of s.docs) { const x=d.data(); const id=x.payload?.draftId; c[id]=(c[id]||0)+1; if(x.serverTs<first)first=x.serverTs; if(x.serverTs>last)last=x.serverTs; }
console.log('total', s.size, first, last);
console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]));
process.exit(0);
