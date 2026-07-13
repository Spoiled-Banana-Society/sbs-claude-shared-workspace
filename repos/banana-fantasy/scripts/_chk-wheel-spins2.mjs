import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const cols = await fs.listCollections();
const names = cols.map(c => c.id);
console.log('spin/wheel-ish collections:', names.filter(id => /wheel|spin/i.test(id)).join(', ') || '(none)');

// Try likely names
for (const name of names.filter(id => /spin/i.test(id))) {
  const snap = await fs.collection(name).orderBy('createdAt', 'desc').limit(8).get().catch(() => null);
  if (!snap) { console.log(`\n${name}: no createdAt order — sampling raw`); continue; }
  console.log(`\n=== ${name} (latest ${snap.size}) ===`);
  for (const d of snap.docs) {
    const s = d.data();
    const ts = typeof s.createdAt?.toDate === 'function' ? s.createdAt.toDate().toISOString() : new Date(s.createdAt).toISOString?.() ?? s.createdAt;
    console.log(`${ts} seg=${s.segmentId ?? s.segment ?? s.prizeLabel ?? s.prize ?? '?'} period=${s.periodNumber ?? '-'} idx=${s.spinIndex ?? '-'} wallet=${(s.wallet||s.userId||'').slice(0,8)}`);
  }
}
process.exit(0);
