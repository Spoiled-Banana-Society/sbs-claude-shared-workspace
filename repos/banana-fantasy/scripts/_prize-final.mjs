#!/usr/bin/env node
// FINAL BBB4 PRIZE LIST → Firestore v2_contests/1 (what /api/contests serves; seed.ts is ignored once docs exist).
//   node scripts/_prize-final.mjs            # dry run: prints current vs new, writes nothing
//   node scripts/_prize-final.mjs --commit   # writes prizeBreakdown + examplePaidDrafts + topPrize
// Richard 9/10 evening: league winner $20 × 1,383, week 15 pod winner $20 × ~273 (1st place ONLY on both), every finalist paid (51st–155th $50), 1st fixed at $25,000.
// Backup of the pre-change doc: ~/sbs-contests-backup/v2_contests_1_2026-09-09.json
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const LEAGUES = 1383;
const PODS15 = 273; // week 15 pods: (2×1,239 Pro + 2×100 HOF + 30 JP + 14 JackHOF) / 10, 1st place only
const LEAGUE_NOTE = `each · ${LEAGUES.toLocaleString('en-US')} leagues`;
const prizeBreakdown = [
  { place: '1st', amount: 25000, section: 'Finals' },
  { place: '2nd', amount: 6500, section: 'Finals' },
  { place: '3rd', amount: 3800, section: 'Finals' },
  { place: '4th', amount: 2300, section: 'Finals' },
  { place: '5th', amount: 1750, section: 'Finals' },
  { place: '6th', amount: 1450, section: 'Finals' },
  { place: '7th', amount: 1250, section: 'Finals' },
  { place: '8th', amount: 1050, section: 'Finals' },
  { place: '9th', amount: 900, section: 'Finals' },
  { place: '10th', amount: 760, section: 'Finals' },
  { place: '11th–25th', amount: 200, note: 'each', section: 'Finals' },
  { place: '26th–50th', amount: 100, note: 'each', section: 'Finals' },
  { place: '51st–155th', amount: 50, note: 'each', section: 'Finals' },
  { place: '1st', amount: 250, note: 'each week', section: 'Weekly (Weeks 1–14)' },
  { place: '2nd', amount: 100, note: 'each week', section: 'Weekly (Weeks 1–14)' },
  { place: '3rd', amount: 50, note: 'each week', section: 'Weekly (Weeks 1–14)' },
  { place: '4th', amount: 35, note: 'each week', section: 'Weekly (Weeks 1–14)' },
  { place: '5th', amount: 20, note: 'each week', section: 'Weekly (Weeks 1–14)' },
  { place: 'Regular-Season League Winner', amount: 20, note: LEAGUE_NOTE, section: 'League Prizes' },
  { place: 'Playoff Round 1 Winner', amount: 20, note: 'each · 1st in every week 15 pod', section: 'League Prizes' },
  { place: 'HOF 1st', amount: 3000, section: 'Hall of Fame' },
  { place: 'HOF 2nd', amount: 1200, section: 'Hall of Fame' },
  { place: 'HOF 3rd', amount: 800, section: 'Hall of Fame' },
];

// Sanity: the list must total exactly $100,000.
const RANGE = /^(\d+)(?:st|nd|rd|th)–(\d+)(?:st|nd|rd|th)$/;
const mult = (p) => (RANGE.test(p.place) ? (+RANGE.exec(p.place)[2] - +RANGE.exec(p.place)[1] + 1)
  : p.section.startsWith('Weekly') ? 14
  : p.place === 'Playoff Round 1 Winner' ? PODS15
  : p.section === 'League Prizes' ? LEAGUES : 1);
const total = prizeBreakdown.reduce((s, p) => s + p.amount * mult(p), 0);
if (total !== 100000) { console.error('TOTAL IS NOT $100,000:', total); process.exit(1); }

const ref = db.collection('v2_contests').doc('1');
const cur = (await ref.get()).data();
if (!cur) { console.error('v2_contests/1 missing'); process.exit(1); }
console.log('current:', cur.name, 'examplePaidDrafts', cur.examplePaidDrafts, 'topPrize', cur.topPrize, 'rows', (cur.prizeBreakdown || []).length);
console.log('new:     examplePaidDrafts', LEAGUES, 'topPrize', 25000, 'rows', prizeBreakdown.length, 'total', total);
for (const p of prizeBreakdown) console.log(`  ${p.section.padEnd(22)} ${p.place.padEnd(30)} $${p.amount.toLocaleString('en-US')} ${p.note || ''}`);

if (!process.argv.includes('--commit')) { console.log('\nDRY RUN. Re-run with --commit to write.'); process.exit(0); }
await ref.update({ prizeBreakdown, examplePaidDrafts: LEAGUES, topPrize: 25000, prizeFinalizedAt: new Date().toISOString() });
const after = (await ref.get()).data();
console.log('\nWROTE. rows now', after.prizeBreakdown.length, '1st =', after.prizeBreakdown[0].amount, 'examplePaidDrafts', after.examplePaidDrafts);
console.log('/api/contests is edge-cached ~30s + the details modal caches per session; hard refresh to see it.');
process.exit(0);
