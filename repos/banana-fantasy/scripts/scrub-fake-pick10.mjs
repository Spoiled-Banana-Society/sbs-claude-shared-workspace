#!/usr/bin/env node
/**
 * One-time cleanup: remove the fake demo Pick-10 history that was cloned into
 * every seeded user's promo doc (lib/api/seed.ts used to ship 3 placeholder
 * rows — League #1042, #892, #756 — two with status 'claim'). Those let users
 * claim 2 wheel spins they never earned. The seed is now clean; this scrubs
 * users already seeded with the fake rows, preserving any REAL Pick 10s.
 *
 * Real entries have draftName === a real draftId; the fakes are these exact
 * placeholder names. We drop only the placeholders, then recompute
 * totalPick10s / claimCount / claimable from what remains.
 *
 * Dry-run by default. Pass --apply to write. Zero config (staging SA from
 * lib/firebaseAdmin.ts, like scripts/logs.mjs); SA_PATH overrides.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RTDB_URL = 'https://sbs-staging-env-default-rtdb.firebaseio.com';
const APPLY = process.argv.includes('--apply');

const FAKE_DRAFT_NAMES = new Set(['League #1042', 'League #892', 'League #756']);

function loadServiceAccount() {
  if (process.env.SA_PATH) return JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
  const src = readFileSync(join(ROOT, 'lib', 'firebaseAdmin.ts'), 'utf8');
  const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
  if (!m) { console.error('No STAGING_SA_B64; set SA_PATH.'); process.exit(1); }
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()), databaseURL: RTDB_URL });
const db = admin.firestore();

async function main() {
  console.log(`Scanning pick-10 promo docs… (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  // collectionGroup over every user's `promos` subcollection. Filter to
  // pick-10 in code so we don't need a composite COLLECTION_GROUP index.
  const all = await db.collectionGroup('promos').get();
  const docs = all.docs.filter((d) => d.data().type === 'pick-10');
  console.log(`Scanned ${all.size} promo docs; ${docs.length} are pick-10.`);

  let touched = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of docs) {
    const data = doc.data();
    const history = Array.isArray(data.modalContent?.pick10History) ? data.modalContent.pick10History : [];
    const real = history.filter((e) => !FAKE_DRAFT_NAMES.has(e?.draftName));
    const hadFake = real.length !== history.length;
    const totalNow = data.modalContent?.totalPick10s ?? 0;
    const realClaim = real.filter((e) => e?.status === 'claim').length;

    if (!hadFake && totalNow === real.length && (data.claimCount ?? 0) === realClaim) continue;

    touched++;
    if (touched <= 10) {
      console.log(`  ${doc.ref.path}: history ${history.length}→${real.length}, total ${totalNow}→${real.length}, claimCount ${data.claimCount ?? 0}→${realClaim}`);
    }
    if (APPLY) {
      batch.set(
        doc.ref,
        {
          claimCount: realClaim,
          claimable: realClaim > 0,
          modalContent: { totalPick10s: real.length, pick10History: real },
        },
        { merge: true },
      );
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }
  }

  if (APPLY && pending > 0) await batch.commit();
  console.log(`${APPLY ? 'Fixed' : 'Would fix'} ${touched} doc(s).${APPLY ? '' : '  Re-run with --apply to write.'}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
