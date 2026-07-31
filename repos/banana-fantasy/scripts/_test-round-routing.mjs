/**
 * Offline check of the wheel/promo round split against the LIVE queue shape.
 * Reproduces findOpenRound (lib/db-firestore.ts) and asserts routing. Reads
 * Firestore, writes nothing.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const QUEUE_MAX = 10;
const roundSource = r => r.source ?? 'wheel';
const findOpenRound = (queue, source, userId) =>
  queue.rounds.find(r => r.status === 'filling' && roundSource(r) === source
    && r.members.length < QUEUE_MAX && !r.members.some(m => m.wallet === userId));

const q = (await db.collection('v2_queues').doc('jackhof').get()).data();
const NEW = '0xnewwinner000000000000000000000000000000';
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got}, want ${want}`);
};

check('wheel win joins the WHEEL round (roarstone\'s)', findOpenRound(q, 'wheel', NEW)?.roundId, 2);
check('banana draw joins the PROMO round', findOpenRound(q, 'promo', NEW)?.roundId, 1);
check('roarstone (already in round 2) gets a NEW wheel round', findOpenRound(q, 'wheel', '0x2ca38068fb250afa8fffbcc548812d14369fbd97')?.roundId, undefined);
check('a promo winner already in round 1 gets a NEW promo round',
  findOpenRound(q, 'promo', '0xeffc7bb82b1495b9b14394ff891d1e14e1f17c8f')?.roundId, undefined);

// Legacy safety: an untagged round must still take wheel wins (jackpot/hof).
const legacy = { rounds: [{ roundId: 99, status: 'filling', members: [], draftId: null }] };
check('untagged legacy round accepts a wheel win', findOpenRound(legacy, 'wheel', NEW)?.roundId, 99);
check('untagged legacy round REFUSES a promo grant', findOpenRound(legacy, 'promo', NEW)?.roundId, undefined);

// Full round must not absorb either kind.
const full = { rounds: [{ roundId: 7, status: 'filling', source: 'wheel', draftId: null,
  members: Array.from({ length: 10 }, (_, i) => ({ wallet: `0x${i}` })) }] };
check('full wheel round is skipped', findOpenRound(full, 'wheel', NEW)?.roundId, undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
