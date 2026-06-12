import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// wheelSpins exists but createdAt-order returned 0 — sample raw + count
const raw = await fs.collection('wheelSpins').limit(5).get();
console.log(`wheelSpins raw sample: ${raw.size}`);
raw.docs.forEach(d => console.log(d.id, JSON.stringify(d.data()).slice(0, 300)));

const cnt = await fs.collection('wheelSpins').count().get();
console.log('wheelSpins total:', cnt.data().count);

// Period spins consumed spinIndex 0..86 per period doc. Look for per-period subcollections
const p1 = fs.collection('wheel_periods').doc('1');
const subs = await p1.listCollections();
console.log('wheel_periods/1 subcollections:', subs.map(c => c.id).join(', ') || '(none)');
for (const sc of subs) {
  if (/spin/i.test(sc.id)) {
    const ss = await sc.orderBy('spinIndex', 'desc').limit(10).get().catch(() => sc.limit(10).get());
    console.log(`--- ${sc.id} latest:`);
    ss.docs.forEach(d => {
      const s = d.data();
      const ts = typeof s.createdAt?.toDate === 'function' ? s.createdAt.toDate().toISOString() : (typeof s.createdAt === 'number' ? new Date(s.createdAt).toISOString() : s.createdAt);
      console.log(`idx=${s.spinIndex} seg=${s.segmentId ?? s.segment} ${ts} wallet=${(s.wallet||'').slice(0,8)}`);
    });
  }
}
process.exit(0);
