import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const wallet = (process.argv[2] || '').toLowerCase();
if (!wallet) {
  console.error('usage: node find-wallet-draft.mjs <wallet>');
  process.exit(1);
}

const tracker = (await db.collection('drafts').doc('draftTracker').get()).data();
const filled = tracker.FilledLeaguesCount;
const live = tracker.CurrentLiveDraftCount;
console.log('FilledLeaguesCount:', filled, ' CurrentLiveDraftCount:', live);

// Scan last 30 slots (filling are usually the most-recent un-filled ones)
const start = Math.max(1, filled - 5);
const end = filled + 30;
console.log(`\nScanning ${start}..${end} fast drafts for wallet ${wallet}`);

for (let n = end; n >= start; n--) {
  const id = `2024-fast-draft-${n}`;
  const snap = await db.collection('drafts').doc(id).get();
  if (!snap.exists) continue;
  const d = snap.data();
  const players = d.LeaguePlayers || d.players || [];
  const hasWallet = (Array.isArray(players) ? players : Object.values(players))
    .some((p) => (p?.OwnerId || p?.ownerId || '').toLowerCase() === wallet);
  if (hasWallet) {
    const cnt = Array.isArray(players) ? players.length : Object.keys(players).length;
    console.log(`  FOUND: ${id}  players=${cnt}/10  filled=${d.IsFilled || d.isFilled}`);
  }
}
process.exit(0);
