import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const tracker = (await db.collection('drafts').doc('draftTracker').get()).data();
console.log('FilledLeaguesCount:', tracker.FilledLeaguesCount);

// Probe slot 798–805 in fast/slow for years 2024, 2025, 2026
console.log('\nDocs by slot id (showing DisplayName + Level):');
for (let n = 798; n <= 805; n++) {
  for (const speed of ['fast', 'slow']) {
    for (const year of ['2024', '2025', '2026']) {
      const id = `${year}-${speed}-draft-${n}`;
      const snap = await db.collection('drafts').doc(id).get();
      if (snap.exists) {
        const d = snap.data();
        console.log(`  ${id}  →  ${d.DisplayName}  ${d.Level || '(no Level)'}`);
      }
    }
  }
}
process.exit(0);
