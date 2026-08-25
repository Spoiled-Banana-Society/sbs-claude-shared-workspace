import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const sa = JSON.parse(Buffer.from(src.match(/STAGING_SA_B64 = '([^']+)'/)[1],'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const COUCH = '0x466d16ec1724f08aaeec2399816160f0d95d9d4f';
const B69   = '0xa551f64ae2791d0fc6c8cad23c22ac3529dbbd2e';
for (const type of ['jackpot','hof','jackhof']) {
  const q = (await db.collection('v2_queues').doc(type).get()).data() || { rounds: [] };
  for (const r of q.rounds || []) {
    const ws = r.members.map(m => m.wallet.toLowerCase());
    const hasC = ws.includes(COUCH), hasB = ws.includes(B69);
    if (hasC || hasB) console.log(type, 'round', r.roundId, r.status, r.source ?? '(wheel)', `${ws.length}/10`, 'draftId=', r.draftId, hasC&&hasB ? '  <<< BOTH' : hasC ? ' couch' : ' banana69',
      hasC&&hasB ? JSON.stringify(r.members.filter(m=>[COUCH,B69].includes(m.wallet.toLowerCase())).map(m=>({w:m.wallet.slice(0,8),tok:m.tokenId,at:new Date(m.joinedAt).toISOString()}))) : '');
  }
}
