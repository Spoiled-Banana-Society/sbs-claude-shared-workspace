// Create (or update) a password-gated private league — ticket-3338 groups.
//
//   node scripts/create-private-league.mjs <id> "<Display Name>" "<password>" [fast|slow|both] [commissionerWallet]
//
// e.g.  node scripts/create-private-league.mjs kffl "KFFL" "some-password" fast 0xabc...
//
// Writes private_leagues/{id} with the sha256 password hash (same canonical
// hashing as the Go verifier: sha256 of the TRIMMED password, hex). Running it
// again on an existing id updates the name/password/speed but never touches
// CurrentDraftId (the Go side owns that). The member link to hand out is:
//   https://sbsfantasy.com/private/<id>
//
// Batch commitments are NOT created here — the Go fill path creates the salt
// and publishes the commit hash the moment the league's first draft fills
// (models/private-league.go ensurePrivateBatchSeed).

import admin from 'firebase-admin';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const b64 = src.match(/STAGING_SA_B64 = '([^']+)'/)[1];
const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const [id, name, password, speedArg, commissioner] = process.argv.slice(2);
if (!id || !name || !password) {
  console.error('usage: node scripts/create-private-league.mjs <id> "<Display Name>" "<password>" [fast|slow|both] [commissionerWallet]');
  process.exit(1);
}
const leagueId = id.toLowerCase();
if (!/^[a-z0-9-]{2,30}$/.test(leagueId)) {
  console.error(`id must be 2-30 chars of a-z 0-9 dash (it becomes the /private/${leagueId} URL)`);
  process.exit(1);
}
const speedLc = (speedArg || 'fast').toLowerCase();
const draftType = speedLc === 'slow' ? 'slow' : speedLc === 'both' ? 'both' : 'fast';
const passwordHash = createHash('sha256').update(password.trim()).digest('hex');

const ref = db.collection('private_leagues').doc(leagueId);
const existing = await ref.get();

await ref.set(
  {
    Name: name,
    PasswordHash: passwordHash,
    DraftType: draftType,
    ...(commissioner ? { CommissionerWallet: commissioner.toLowerCase() } : {}),
    ...(existing.exists ? {} : { CurrentDraftId: '', CreatedAt: new Date() }),
  },
  { merge: true },
);

console.log(`${existing.exists ? 'Updated' : 'Created'} private league "${name}" (${draftType})`);
console.log(`  link:     https://sbsfantasy.com/private/${leagueId}`);
console.log(`  password: ${password.trim()}  (hash ${passwordHash.slice(0, 12)}…)`);
