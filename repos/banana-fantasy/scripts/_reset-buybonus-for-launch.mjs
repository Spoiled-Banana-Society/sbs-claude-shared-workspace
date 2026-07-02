/**
 * ⚠️ LAUNCH-DAY ONLY — DO NOT RUN CASUALLY. WRITES TO EVERY USER.
 *
 * Resets the buy-bonus ("Buy 2 → 1 Free") promo doc for ALL users to a
 * clean slate: progressCurrent 0, claimCount 0, claimable false.
 *
 * WHY: the promo has been hidden but the purchase path kept counting —
 * as of 2026-07-02, 42 users had silently banked 173 unclaimed free
 * drafts (see _audit-buybonus.mjs). If the promo goes public WITHOUT
 * this reset, all of that becomes instantly claimable. Run this at the
 * moment the promo launches so only July-4th-weekend purchases count.
 *
 * Usage:
 *   node scripts/_reset-buybonus-for-launch.mjs           # dry run (prints what it would do)
 *   node scripts/_reset-buybonus-for-launch.mjs --apply   # actually write
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APPLY = process.argv.includes('--apply');
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const userRefs = await db.collection('v2_users').listDocuments();
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — scanning ${userRefs.length} users`);
let toReset = 0, wiped = 0;
for (let i = 0; i < userRefs.length; i += 100) {
  const chunk = userRefs.slice(i, i + 100).map((u) => u.collection('promos').doc('7'));
  const snaps = await db.getAll(...chunk);
  const batch = db.batch();
  let inBatch = 0;
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data();
    if ((d.claimCount || 0) === 0 && (d.progressCurrent || 0) === 0 && !d.claimable) continue;
    toReset++;
    wiped += d.claimCount || 0;
    if (APPLY) {
      batch.set(s.ref, { progressCurrent: 0, claimCount: 0, claimable: false }, { merge: true });
      inBatch++;
    }
  }
  if (APPLY && inBatch > 0) await batch.commit();
}
console.log(`users needing reset: ${toReset}; unclaimed milestones wiped: ${wiped}`);
console.log(APPLY ? 'DONE — promo is clean for launch.' : 'Dry run only. Re-run with --apply to write.');
