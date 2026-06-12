import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const snap = await fs.collection('wheelAssignmentJournal').get();
console.log(`wheelAssignmentJournal docs: ${snap.size}`);
const entries = [];
for (const d of snap.docs) {
  const x = d.data();
  if (Array.isArray(x.entries)) entries.push(...x.entries);
  else entries.push({ id: d.id, ...x });
}
console.log(`total entries: ${entries.length}`);
const ts = (e) => e.timestamp ?? e.assignedAt ?? e.createdAt ?? '?';
entries.sort((a, b) => String(ts(a)).localeCompare(String(ts(b))));
console.log('\nsample shape:', JSON.stringify(entries[0]).slice(0, 250));
console.log('\nlast 12 assignments:');
for (const e of entries.slice(-12)) {
  const t = typeof ts(e)?.toDate === 'function' ? ts(e).toDate().toISOString() : (typeof ts(e) === 'number' ? new Date(ts(e)).toISOString() : ts(e));
  console.log(`idx=${e.spinIndex} ${t} wallet=${(e.wallet||'').slice(0,8)} seg=${e.segmentId ?? e.result ?? '-'}`);
}
process.exit(0);
