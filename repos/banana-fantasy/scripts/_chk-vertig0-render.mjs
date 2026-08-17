import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W = '0x696012486d4629baa75e0f44a481f127f6705e1e';
const s = await db.collection('v2_debug_events').where('serverTs','>=','2026-08-16T12:00:00Z').where('serverTs','<','2026-08-17T03:00:00Z').get();
const docs = s.docs.map(d=>d.data()).filter(d=>d.wallet===W).sort((a,b)=>String(a.serverTs).localeCompare(String(b.serverTs)));
console.log('vertig0 events', docs.length);
// sessions on /draft: minute buckets
const mins = new Map();
for (const x of docs) { const k = x.serverTs.slice(0,16)+' '+x.path; mins.set(k,(mins.get(k)||0)+1); }
console.log('--- /draft minute buckets'); for (const [k,v] of mins) if (k.endsWith(' /draft')) console.log(k,v);
console.log('--- DraftRow.render by slot (count) + gate for slow-72');
const rend = {}; for (const x of docs) if (x.event==='DraftRow.render') { const id=x.payload?.slotId; rend[id]=(rend[id]||0)+1; }
console.log(rend);
for (const x of docs) if ((x.payload?.slotId==='2026-slow-draft-72' || x.payload?.draftId==='2026-slow-draft-72') ) console.log(x.serverTs, x.tag, x.event, x.path, JSON.stringify(x.payload).slice(0,300));
console.log('--- lobby-pick applied 8/16');
for (const x of docs) if (x.tag==='lobby-pick' || x.tag==='mydrafts' || x.tag==='storage#' || (x.tag==='prune'&&x.event==='remove')) console.log(x.serverTs, x.tag, x.event, x.path, JSON.stringify(x.payload).slice(0,300));
process.exit(0);
