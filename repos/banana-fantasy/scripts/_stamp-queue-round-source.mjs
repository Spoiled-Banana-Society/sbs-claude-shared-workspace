/**
 * Migration for the wheel/promo round split (2026-07-30).
 *
 * Stamps `source` on every existing v2_queues round. Origin is DERIVED from each
 * member's pass_origin doc, not assumed: a round holding any Banana Draw grant
 * (origin admin_grant + reason banana_draw:*) is 'promo', everything else is
 * 'wheel'. Untagged rounds already read as 'wheel' in code, so this is only
 * load-bearing for the promo round — but stamping all of them makes the state
 * explicit instead of relying on a default.
 *
 * Safe to run before the code deploys: the current build round-trips unknown
 * round fields untouched.
 *
 * Run:  node scripts/_stamp-queue-round-source.mjs           (dry run)
 *       node scripts/_stamp-queue-round-source.mjs --commit
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const COMMIT = process.argv.includes('--commit');

async function originOf(tokenId) {
  const d = await db.collection('pass_origin').doc(String(tokenId)).get();
  if (!d.exists) return null;
  const { origin, reason } = d.data();
  return { origin, reason };
}

for (const type of ['jackpot', 'hof', 'jackhof']) {
  const ref = db.collection('v2_queues').doc(type);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`${type}: (absent)`); continue; }
  const queue = snap.data();
  console.log(`\n### ${type}`);

  for (const r of queue.rounds || []) {
    const origins = [];
    for (const m of r.members || []) {
      if (!m.tokenId) { origins.push('(wallet-keyed)'); continue; }
      const o = await originOf(m.tokenId);
      origins.push(o ? `${o.origin}${o.reason ? `/${o.reason}` : ''}` : '(no pass_origin)');
    }
    const isPromo = origins.some(o => o.startsWith('admin_grant/banana_draw'));
    const source = isPromo ? 'promo' : 'wheel';
    const mixed = isPromo && origins.some(o => o.startsWith('spin_reward'));
    console.log(`  round ${r.roundId} (${r.status}, ${origins.length} members) -> ${source}${r.source ? ` [was ${r.source}]` : ''}${mixed ? '  ⚠️ MIXED' : ''}`);
    for (const o of origins) console.log(`      ${o}`);
    r.source = source;
  }

  if (COMMIT) {
    await ref.set(queue);
    console.log(`  WROTE ${type}`);
  }
}

console.log(COMMIT ? '\nDONE' : '\nDRY RUN — nothing written. Re-run with --commit.');
process.exit(0);
