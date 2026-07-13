import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// All wheel periods with lifecycle timestamps
const periods = await fs.collection('wheel_periods').orderBy('periodNumber', 'desc').limit(10).get();
console.log(`=== wheel_periods (${periods.size}) ===`);
for (const d of periods.docs) {
  const p = d.data();
  console.log(`#${p.periodNumber} status=${p.status} spinCount=${p.spinCount ?? 0}`);
  for (const k of ['createdAt','openedAt','fulfilledAt','activatedAt','finalizedAt','rootCommittedAt','closedAt','revealedAt']) {
    if (p[k]) console.log(`   ${k}: ${typeof p[k]?.toDate === 'function' ? p[k].toDate().toISOString() : p[k]}`);
  }
}

// Recent spins: which path (period vs legacy), what segment, when
const spins = await fs.collection('wheel_spins').orderBy('createdAt', 'desc').limit(15).get().catch(() => null);
if (spins) {
  console.log(`\n=== recent wheel_spins (${spins.size}) ===`);
  for (const d of spins.docs) {
    const s = d.data();
    const ts = typeof s.createdAt?.toDate === 'function' ? s.createdAt.toDate().toISOString() : s.createdAt;
    console.log(`${ts}  seg=${s.segmentId ?? s.segment?.id ?? s.prize ?? '?'}  period=${s.periodNumber ?? '(legacy)'}  spinIndex=${s.spinIndex ?? '-'}`);
  }
} else {
  console.log('\n(no wheel_spins collection — checking alternates)');
  const cols = await fs.listCollections();
  console.log('collections w/ wheel:', cols.map(c => c.id).filter(id => /wheel|spin/i.test(id)).join(', '));
}
process.exit(0);
