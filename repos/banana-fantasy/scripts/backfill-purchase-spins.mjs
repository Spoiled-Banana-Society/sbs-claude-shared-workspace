// Backfill Bonus Spins for passes bought BEFORE the spin-on-purchase flip.
// One spin per paid pass, from v2_activity_events pass_purchased records.
//
//   node scripts/backfill-purchase-spins.mjs 2026-07-27            # dry run
//   node scripts/backfill-purchase-spins.mjs 2026-07-27 --apply    # grant
//   node scripts/backfill-purchase-spins.mjs 2026-07-27 2026-07-29 --apply
//
// ⚠️ Run AFTER the feature is deployed with both flags on. Granted spins are
// invisible (and unspendable) until the new build is live — and granting into
// the old build creates a badge/wheel mismatch.
//
// Idempotent: each event id gets a marker doc in v2_spin_backfill, so rerunning
// with an overlapping window never double-grants.
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';

const SA = process.env.SA_PATH || '/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(SA, 'utf8'))), projectId: 'sbs-staging-env' });
const db = admin.firestore();

// Agreed backfill start (Richard 2026-07-27): 6:00am PT on July 27.
// Running with no date args uses this through "now" — the run-at-flip default.
const DEFAULT_START = '2026-07-27T06:00:00-07:00';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
// Args may be full ISO datetimes (with offset) or bare YYYY-MM-DD (= PT midnight).
const parseArg = (a) => (a.includes('T') ? Date.parse(a) : Date.parse(`${a}T00:00:00-07:00`));
const startIso = new Date(args[0] ? parseArg(args[0]) : Date.parse(DEFAULT_START)).toISOString();
const endIso = args[1]
  ? new Date(args[1].includes('T') ? Date.parse(args[1]) : parseArg(args[1]) + 24 * 3600 * 1000).toISOString()
  : new Date().toISOString(); // "until now" — run this right at flip time

const snap = await db.collection('v2_activity_events')
  .where('createdAtIso', '>=', startIso)
  .where('createdAtIso', '<', endIso)
  .get();

const buys = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((e) => e.type === 'pass_purchased' && e.paymentMethod !== 'free' && (e.quantity ?? 0) > 0)
  .sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — window ${startIso} → ${endIso}`);
console.log(`pass_purchased events: ${buys.length}\n`);

const perUser = new Map();
let granted = 0, skipped = 0;
for (const e of buys) {
  const marker = db.collection('v2_spin_backfill').doc(e.id);
  if ((await marker.get()).exists) { skipped++; continue; }
  perUser.set(e.userId, (perUser.get(e.userId) || 0) + e.quantity);
  console.log(`${e.createdAtIso}  ${e.userId}  ${e.username ?? ''}  +${e.quantity} spin${e.quantity !== 1 ? 's' : ''}`);
  if (APPLY) {
    await db.runTransaction(async (tx) => {
      const m = await tx.get(marker);
      if (m.exists) return; // concurrent-run guard
      tx.set(db.collection('v2_users').doc(e.userId),
        { purchaseSpins: admin.firestore.FieldValue.increment(e.quantity) }, { merge: true });
      tx.set(marker, { eventId: e.id, userId: e.userId, quantity: e.quantity, grantedAt: new Date().toISOString() });
    });
    granted += e.quantity;
  }
}
console.log(`\nper-user totals:`);
for (const [u, n] of perUser) console.log(`  ${u}  +${n}`);
console.log(APPLY ? `\ngranted ${granted} spins (${skipped} events already backfilled, skipped)` : `\ndry run — nothing written (${skipped} already backfilled)`);
process.exit(0);
