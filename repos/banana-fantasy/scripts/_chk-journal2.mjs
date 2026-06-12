import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const entries = await fs.collection('wheelAssignmentJournal').doc('1').collection('entries')
  .orderBy('spinIndex', 'asc').get();
console.log(`period-1 journal entries: ${entries.size}`);
console.log('sample:', JSON.stringify(entries.docs[0]?.data()).slice(0, 250));
console.log('\nlast 10:');
for (const d of entries.docs.slice(-10)) {
  const e = d.data();
  const t = typeof e.assignedAt?.toDate === 'function' ? e.assignedAt.toDate().toISOString()
    : typeof e.assignedAt === 'number' ? new Date(e.assignedAt).toISOString()
    : e.assignedAt ?? e.timestamp ?? '?';
  console.log(`idx=${e.spinIndex} ${t} wallet=${(e.wallet||'').slice(0,10)}`);
}
process.exit(0);
