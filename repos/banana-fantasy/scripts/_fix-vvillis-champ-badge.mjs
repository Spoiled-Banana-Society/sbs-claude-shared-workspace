// One-off: fix VVillis's champion badge from BBB IV (season 4) -> BBB III (season 3).
// He IS the correct 2025/BBB3 finals winner; only the season label was wrong.
// Run:  SA_PATH=/path/to/staging-sa.json node scripts/_fix-vvillis-champ-badge.mjs
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const WALLET = '0x3236ddfc6a12222bef7f29fe192b2802c07c1cfe';
const WRONG = 'bbb-champion-4';
const RIGHT = 'bbb-champion-3';

const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const userRef = db.collection('v2_users').doc(WALLET);
const badges = userRef.collection('badges');

const show = async (tag) => {
  const u = (await userRef.get()).data() || {};
  const w = (await badges.doc(WRONG).get()).data() || null;
  const r = (await badges.doc(RIGHT).get()).data() || null;
  console.log(`[${tag}] equippedBadge=${u.equippedBadge ?? null}  ${WRONG}=${w ? w.unlocked : 'absent'}  ${RIGHT}=${r ? r.unlocked : 'absent'}`);
};

await show('before');

// 1) unlock the correct season-3 badge
await badges.doc(RIGHT).set(
  { id: RIGHT, unlocked: true, unlockedAt: new Date().toISOString(), source: { source: 'season-label-fix' } },
  { merge: true },
);
// 2) revoke the wrong season-4 badge
await badges.doc(WRONG).set({ id: WRONG, unlocked: false }, { merge: true });
// 3) if season-4 was equipped (or nothing is), equip season-3
const cur = (await userRef.get()).data() || {};
if (cur.equippedBadge === WRONG || !cur.equippedBadge) {
  await userRef.set({ equippedBadge: RIGHT }, { merge: true });
}

await show('after');
console.log('Done.');
process.exit(0);
