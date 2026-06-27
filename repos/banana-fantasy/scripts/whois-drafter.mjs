// Read-only: identify who is on the clock in a draft.
// Usage:
//   SA_PATH=/path/to/serviceAccount.json node scripts/whois-drafter.mjs 2026-slow-draft-0 Banana85005
//   (or) run from a dir with .env.production containing FIREBASE_SERVICE_ACCOUNT_JSON=<base64>
//   PROJECT env overrides the project id (default sbs-staging-env, since sbsfantasy.com uses the staging backend).
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'node:fs';

const DRAFT_ID = process.argv[2] || '2026-slow-draft-0';
const HANDLE   = process.argv[3] || 'Banana85005';

// --- credential resolution (no scanning; you point it at your SA) ---
let cred;
if (process.env.SA_PATH) {
  cred = admin.credential.cert(JSON.parse(readFileSync(process.env.SA_PATH, 'utf8')));
} else if (existsSync('.env.production')) {
  const m = readFileSync('.env.production', 'utf8').match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
  cred = admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')));
} else {
  cred = admin.credential.applicationDefault(); // uses your gcloud ADC
}
admin.initializeApp({ credential: cred, projectId: process.env.PROJECT || 'sbs-staging-env' });
const fs = admin.firestore();
console.log('project:', await admin.app().options.projectId || process.env.PROJECT);
console.log('draft:', DRAFT_ID, '| looking for handle:', HANDLE, '\n');

const dump = (label, obj) => {
  const safe = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (/email|wallet|owner|privy|did|login|provider|auth|handle|name|address|phone|created/i.test(k)) safe[k] = v;
  }
  console.log(label, JSON.stringify(safe, null, 2));
};

// 1) draft doc -> find the player on slot/pick 2 or matching handle
const draft = (await fs.collection('drafts').doc(DRAFT_ID).get()).data() || {};
console.log('draft keys:', Object.keys(draft).join(', '));
const players = draft.LeaguePlayers || draft.players || draft.CurrentUsers || draft.Players || [];
const list = Array.isArray(players) ? players : Object.values(players);
console.log('player count:', list.length, '\n');

let target = null;
list.forEach((p, i) => {
  const owner = (p?.OwnerId || p?.ownerId || p?.wallet || p?.Wallet || '').toString();
  const name  = (p?.Handle || p?.handle || p?.DisplayName || p?.displayName || p?.name || '').toString();
  const pick  = p?.PickNumber ?? p?.pickNumber ?? p?.DraftPosition ?? p?.draftPosition ?? (i + 1);
  console.log(`  slot ${String(pick).padStart(2)}  ${name.padEnd(16)}  ${owner}`);
  if (name === HANDLE || String(pick) === '2') target = { owner, name, pick };
});

if (!target?.owner) {
  console.log('\nCould not resolve a wallet from the draft doc. Inspect the structure above.');
  process.exit(0);
}
const wallet = target.owner.toLowerCase();
console.log(`\n>>> on the clock: ${target.name}  wallet=${wallet}\n`);

// 2) identity lookups across the user collections
for (const path of [`owners/${wallet}`, `v2_users/${wallet}`, `socialUsers/${wallet}`]) {
  const snap = await fs.doc(path).get();
  if (snap.exists) dump(`\n[${path}]`, snap.data());
}
// also search by handle in case the user doc id isn't the wallet
for (const col of ['v2_users', 'owners', 'socialUsers']) {
  for (const field of ['handle', 'displayName', 'Handle', 'DisplayName', 'name']) {
    const q = await fs.collection(col).where(field, '==', HANDLE).limit(2).get().catch(() => null);
    if (q && !q.empty) q.forEach((d) => dump(`\n[${col}/${d.id}] (by ${field})`, d.data()));
  }
}
console.log('\nSignup method hint: an "email"/"google"/"privy" login field = embedded (web2) signup; a bare wallet with no email and a non-custodial provider = web3 wallet.');
process.exit(0);
