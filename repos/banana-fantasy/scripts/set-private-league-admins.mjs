// Set the commissioner AdminWallets (and optionally DefaultEntries) on a
// private league config — ticket-3338 admin view access.
//
//   node scripts/set-private-league-admins.mjs <id> <wallet> [wallet ...]
//   node scripts/set-private-league-admins.mjs <id> --default-entries 1 <wallet...>
//
// REPLACES the AdminWallets list with exactly the wallets given (lowercased).
// Site admins (Richard/Boris) always have access regardless of this list —
// so an empty/absent list means "team-only" (the review state before a
// commissioner is granted access). Entry bumps are done from the admin page
// itself (/private/<id>/admin), not from this script.

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const b64 = src.match(/STAGING_SA_B64 = '([^']+)'/)[1];
const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const args = process.argv.slice(2);
const id = (args.shift() || '').toLowerCase();
let defaultEntries;
const wallets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--default-entries') {
    defaultEntries = Number(args[++i]);
    continue;
  }
  wallets.push(args[i].trim().toLowerCase());
}

if (!id || (wallets.length === 0 && defaultEntries === undefined)) {
  console.error('usage: node scripts/set-private-league-admins.mjs <id> [--default-entries N] <wallet...>');
  process.exit(1);
}
for (const w of wallets) {
  if (!/^0x[0-9a-f]{40}$/.test(w)) {
    console.error(`not a wallet address: ${w}`);
    process.exit(1);
  }
}
if (defaultEntries !== undefined && (!Number.isInteger(defaultEntries) || defaultEntries < 1)) {
  console.error('--default-entries must be a positive integer');
  process.exit(1);
}

const ref = db.collection('private_leagues').doc(id);
const snap = await ref.get();
if (!snap.exists) {
  console.error(`private league "${id}" does not exist — create it first with create-private-league.mjs`);
  process.exit(1);
}

const patch = {};
if (wallets.length > 0) patch.AdminWallets = wallets;
if (defaultEntries !== undefined) patch.DefaultEntries = defaultEntries;
await ref.set(patch, { merge: true });

console.log(`Updated private league "${id}":`);
if (wallets.length > 0) {
  console.log(`  AdminWallets = ${JSON.stringify(wallets)}`);
  console.log(`  admin page:    https://sbsfantasy.com/private/${id}/admin`);
}
if (defaultEntries !== undefined) console.log(`  DefaultEntries = ${defaultEntries}`);
