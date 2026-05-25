import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const saPath = '/Users/borisvagner/.gcp/sbs-staging-sa.json';
if (fs.existsSync(saPath)) {
  const saJson = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  initializeApp({ credential: cert(saJson) });
} else {
  initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

// ----- PROMO CLAIMS -----
console.log('=== v2_user_events.eventType=promo_claimed ===');
const ueSnap = await db.collection('v2_user_events').where('eventType', '==', 'promo_claimed').limit(50000).get();
console.log(`Total docs: ${ueSnap.size}`);
const byType = {};
for (const d of ueSnap.docs) {
  const data = d.data();
  const t = String(data.meta?.promoType ?? 'unknown');
  byType[t] = (byType[t] ?? 0) + 1;
}
console.log('By promoType:', byType);

console.log('\n=== v2_activity_events.type=promo_claimed ===');
const aeSnap = await db.collection('v2_activity_events').where('type', '==', 'promo_claimed').limit(50000).get();
console.log(`Total docs: ${aeSnap.size}`);
const byType2 = {};
for (const d of aeSnap.docs) {
  const data = d.data();
  const t = String(data.metadata?.promoType ?? 'unknown');
  byType2[t] = (byType2[t] ?? 0) + 1;
}
console.log('By promoType:', byType2);

// ----- WHEEL SPINS -----
console.log('\n=== wheelSpins collectionGroup ===');
const wsSnap = await db.collectionGroup('wheelSpins').limit(50000).get();
console.log(`Total docs: ${wsSnap.size}`);
const shapes = new Map();
const unrecognized = [];
for (const doc of wsSnap.docs) {
  const data = doc.data();
  const hasPrize = !!data.prize;
  const prizeType = data.prize?.type ?? 'none';
  const prizeKeys = data.prize ? Object.keys(data.prize).join(',') : 'none';
  const topKeys = Object.keys(data).sort().join(',');
  const sig = `topKeys=${topKeys} | prize.keys=${prizeKeys} | prize.type=${prizeType}`;
  if (!shapes.has(sig)) shapes.set(sig, { count: 0, sample: data, path: doc.ref.path });
  shapes.get(sig).count += 1;
  // Capture unrecognized for inspection
  const pt = prizeType;
  const pv = data.prize?.value;
  const isRecognized =
    (pt === 'draft_pass' && typeof pv === 'number') ||
    (pt === 'custom' && (pv === 'jackpot' || pv === 'hof')) ||
    (pt === 'nothing');
  if (!isRecognized && unrecognized.length < 8) {
    unrecognized.push({ path: doc.ref.path, data });
  }
}
console.log('Shapes found:');
for (const [sig, info] of [...shapes.entries()].sort((a,b) => b[1].count - a[1].count)) {
  console.log(`  ${String(info.count).padStart(4)} × ${sig}`);
}
console.log('\nFirst few unrecognized docs:');
for (const u of unrecognized) {
  console.log(`  ${u.path}`);
  console.log(`    ${JSON.stringify(u.data).slice(0, 300)}`);
}
