import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const sa = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const VISIBLE = ['new-user', 'mint', 'daily-drafts', 'pick-10', 'jackpot', 'referral'];

// Source 1: claimCount sum
const claimByType = {};
const pg = await db.collectionGroup('promos').limit(50000).get();
for (const d of pg.docs) {
  const data = d.data();
  const t = String(data.type ?? '?');
  const cc = typeof data.claimCount === 'number' ? data.claimCount : 0;
  claimByType[t] = (claimByType[t] ?? 0) + cc;
}

// Source 2: event count
const eventByType = {};
const ue = await db.collection('v2_user_events').where('eventType', '==', 'promo_claimed').limit(100000).get();
for (const d of ue.docs) {
  const t = String(d.data().meta?.promoType ?? '?');
  eventByType[t] = (eventByType[t] ?? 0) + 1;
}

console.log('═══ RECONCILED PROMO TOTALS (what dashboard will show) ═══\n');
console.log('Promo                    claimCount  events  max() = dashboard');
console.log('─────────────────────    ──────────  ──────  ──────────────────');
for (const t of VISIBLE) {
  const cc = claimByType[t] ?? 0;
  const ev = eventByType[t] ?? 0;
  const max = Math.max(cc, ev);
  console.log(`  ${t.padEnd(20)}    ${String(cc).padStart(6)}     ${String(ev).padStart(6)}  ${String(max).padStart(8)}`);
}
console.log('\nBuy-bonus (filtered out per Boris):  claimCount=' + (claimByType['buy-bonus'] ?? 0) + '  events=' + (eventByType['buy-bonus'] ?? 0));
