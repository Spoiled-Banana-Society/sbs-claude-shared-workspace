import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W = '0x696012486d4629baa75e0f44a481f127f6705e1e';
const [from,to] = [process.argv[2]||'2026-08-17T00:05:00Z', process.argv[3]||'2026-08-17T01:45:00Z'];
const s = await db.collection('v2_debug_events').where('serverTs','>=',from).where('serverTs','<',to).get();
const docs = s.docs.map(d=>d.data()).filter(d=>d.wallet===W).sort((a,b)=>String(a.serverTs).localeCompare(String(b.serverTs)));
console.log('vertig0 events', docs.length);
const skip = new Set(['rtdb.unsubscribe','rtdb.subscribe','hook.subscribe','hook.unsubscribe','mydrafts.handler.fired','mydrafts.handler.parsed','cache.set.noop','rest.fetch.start','keep.filling-live','set.poll','DraftRow.gate','rest.fetch.not-ok','rtdb.event','DraftRow.render','mydrafts.handler.no-parse','rest.fetch.ok','fallback.won','hook.update','done','start']);
for (const x of docs) if (!skip.has(x.event) || JSON.stringify(x.payload).includes('slow-draft-72')) console.log(x.serverTs, x.tag, x.event, x.path, x.sessionId?.slice(0,8), JSON.stringify(x.payload).slice(0,260));
// session ids + paths timeline compressed
console.log('--- sessions');
let last=''; for (const x of docs){ const k=x.sessionId?.slice(0,8)+' '+x.path; if(k!==last){console.log(x.serverTs,k); last=k;} }
process.exit(0);
