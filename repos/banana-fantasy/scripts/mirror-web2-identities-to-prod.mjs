#!/usr/bin/env node
// Mirror the FINISHED `web2_social_identities` collection from STAGING
// (sbs-staging-env) into PROD (sbs-prod-env), so returning web2/Gmail players
// are recognized on first login in prod exactly like they are in staging.
//
// WHY a copy (not a rebuild): staging's docs are already in the exact shape the
// login route reads — doc id `email:<lowercased>` / `x:<lowercased,no @>`, field
// `wallet` = old wallet (app/api/users/returning-check/route.ts:171-180). Copying
// the proven collection is the truest "make prod identical to staging" and avoids
// re-deriving the transform from raw old-prod `socialUsers`.
//
// SAFETY:
//   • DATA-ONLY. Writes ONE collection the app only ever READS. Touches no user
//     accounts, money, winnings, or code. Idempotent (merge) — re-running is a no-op.
//   • DRY-RUN by default (reads staging, prints counts, writes NOTHING).
//   • Refuses to run unless source project == sbs-staging-env AND dest == sbs-prod-env.
//
// CREDENTIALS:
//   • SOURCE (staging, read)  → FIREBASE_SERVICE_ACCOUNT_JSON in ./.env.production (base64).
//   • DEST   (prod,   write)  → supply the prod SA one of two ways:
//        PROD_SA_B64=<base64 of the sbs-prod-env service-account JSON>   (preferred)
//        PROD_SA_PATH=/abs/path/to/prod-sa.json
//
// RUN (from ~/banana-fantasy):
//   preview:   PROD_SA_B64=$(cat prod-sa.json | base64) node scripts/mirror-web2-identities-to-prod.mjs
//   execute:   PROD_SA_B64=$(cat prod-sa.json | base64) node scripts/mirror-web2-identities-to-prod.mjs --go
//   (run prod writes from your OWN shell via `!` — the sbs-safety hook blocks Claude from prod.)

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const GO = process.argv.includes('--go');
const COLLECTION = 'web2_social_identities';
const SRC_PROJECT = 'sbs-staging-env';
const DST_PROJECT = 'sbs-prod-env';

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }

// ── Source creds (staging) ──────────────────────────────────────────────────
let srcSa;
try {
  const envText = readFileSync('.env.production', 'utf8');
  const m = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
  if (!m) die('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.production (source/staging creds).');
  srcSa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
} catch (e) { die(`Could not read staging creds from .env.production: ${e.message}`); }

// ── Dest creds (prod) ───────────────────────────────────────────────────────
let dstSa;
if (process.env.PROD_SA_B64) {
  dstSa = JSON.parse(Buffer.from(process.env.PROD_SA_B64, 'base64').toString('utf8'));
} else if (process.env.PROD_SA_PATH) {
  dstSa = JSON.parse(readFileSync(process.env.PROD_SA_PATH, 'utf8'));
} else {
  die('Provide the PROD service account via PROD_SA_B64=<base64> or PROD_SA_PATH=/abs/path.json');
}

// ── Hard project guards (refuse to touch the wrong databases) ────────────────
if (srcSa.project_id !== SRC_PROJECT) die(`Source SA is "${srcSa.project_id}", expected ${SRC_PROJECT}. Aborting.`);
if (dstSa.project_id !== DST_PROJECT) die(`Dest SA is "${dstSa.project_id}", expected ${DST_PROJECT}. Aborting.`);

const srcApp = initializeApp({ credential: cert(srcSa) }, 'src');
const dstApp = initializeApp({ credential: cert(dstSa) }, 'dst');
const srcDb = getFirestore(srcApp);
const dstDb = getFirestore(dstApp);

const tag = GO ? '🔴 EXECUTE (writing to PROD)' : '🟡 DRY-RUN (nothing written)';
console.log(`\n========== MIRROR ${COLLECTION}: ${SRC_PROJECT} → ${DST_PROJECT} — ${tag} ==========\n`);

// ── Read the finished staging collection ────────────────────────────────────
const srcSnap = await srcDb.collection(COLLECTION).get();
const docs = srcSnap.docs;

let emailCount = 0, xCount = 0, otherCount = 0, missingWallet = 0;
const ID_RE = /^(email|x):.+/;
const bad = [];
for (const d of docs) {
  const id = d.id;
  const wallet = d.get('wallet');
  if (!ID_RE.test(id)) { otherCount++; bad.push(`unexpected id: ${id}`); continue; }
  if (id.startsWith('email:')) emailCount++; else xCount++;
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) { missingWallet++; bad.push(`bad/missing wallet on ${id}: ${wallet}`); }
}

console.log(`Source (${SRC_PROJECT}) ${COLLECTION}: ${docs.length} docs`);
console.log(`  email: ${emailCount}   x: ${xCount}   unexpected-id: ${otherCount}   bad/missing wallet: ${missingWallet}`);
if (bad.length) {
  console.log(`\n  ⚠️  ${bad.length} record(s) flagged (shown up to 10):`);
  bad.slice(0, 10).forEach((b) => console.log(`     - ${b}`));
}

// Existing prod state (so a re-run is visibly idempotent, never a surprise wipe)
const dstBefore = await dstDb.collection(COLLECTION).count().get();
console.log(`\nDest (${DST_PROJECT}) ${COLLECTION} BEFORE: ${dstBefore.data().count} docs`);
console.log(`(merge write — existing prod docs are updated in place, never deleted)\n`);

if (!GO) {
  const sample = docs.slice(0, 3).map((d) => ({ id: d.id, wallet: d.get('wallet') }));
  console.log('Sample of what WOULD be written:');
  sample.forEach((s) => console.log(`  ${s.id}  →  ${s.wallet}`));
  console.log(`\n🟡 DRY-RUN complete. Re-run with --go to write ${docs.length} docs to ${DST_PROJECT}.\n`);
  process.exit(0);
}

// ── Write (merge) to prod in batches ────────────────────────────────────────
let written = 0;
const BATCH = 400;
for (let i = 0; i < docs.length; i += BATCH) {
  const slice = docs.slice(i, i + BATCH);
  const batch = dstDb.batch();
  for (const d of slice) {
    // Copy the doc verbatim (preserves `wallet` + any extra provenance fields).
    batch.set(dstDb.collection(COLLECTION).doc(d.id), d.data(), { merge: true });
  }
  await batch.commit();
  written += slice.length;
  console.log(`  …wrote ${written}/${docs.length}`);
}

const dstAfter = await dstDb.collection(COLLECTION).count().get();
console.log(`\n✅ Done. ${written} docs merged into ${DST_PROJECT} ${COLLECTION}.`);
console.log(`Dest AFTER: ${dstAfter.data().count} docs.\n`);
