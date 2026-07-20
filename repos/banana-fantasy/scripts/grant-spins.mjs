/**
 * grant-spins.mjs — grant Free Banana Spins to users, working exactly like a
 * claimed promo spin (same counter the wheel reads; spins run the normal
 * /api/wheel/spin flow with normal odds + first-purchase gate behavior).
 *
 * Per grant (mirrors the founder grant-spins route + CrampyG/foldmysocks):
 *   - wheelSpins increment + promo_claimed activity event in ONE transaction
 *   - bell notification ("N Free Spins added") + live RTDB ping
 *
 * Usage (from ~/banana-fantasy):
 *   node scripts/grant-spins.mjs 0xWALLET:2 SomeUsername:1 ...
 * Each arg = wallet-or-username : spin count. Usernames resolve case-insensitively
 * and must match exactly one account.
 */
import admin from 'firebase-admin';
import fs from 'fs';
const sa = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rtdb = admin.database();
const { FieldValue } = admin.firestore;

const args = process.argv.slice(2);
if (!args.length) { console.log('usage: node scripts/grant-spins.mjs <wallet-or-username>:<count> ...'); process.exit(1); }

let usersSnap = null;
async function resolve(target) {
  if (/^0x[0-9a-f]{40}$/i.test(target)) return target.toLowerCase();
  if (!usersSnap) usersSnap = await db.collection('v2_users').get();
  const t = target.toLowerCase();
  const hits = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if ([u.username, u.displayName].some((x) => String(x || '').toLowerCase() === t)) hits.push(d.id);
  });
  if (hits.length === 1) return hits[0];
  throw new Error(`username "${target}" matched ${hits.length} accounts — need exactly 1`);
}

for (const arg of args) {
  const m = arg.match(/^(.+):(\d+)$/);
  if (!m) { console.log(`SKIP malformed arg: ${arg}`); continue; }
  const [, target, countStr] = m;
  const count = Number(countStr);
  if (!Number.isInteger(count) || count < 1 || count > 20) { console.log(`SKIP ${target}: bad count ${countStr}`); continue; }
  let uid;
  try { uid = await resolve(target.trim()); } catch (e) { console.log(`SKIP ${target}: ${e.message}`); continue; }

  const userRef = db.collection('v2_users').doc(uid);
  const before = (await userRef.get()).data();
  if (!before) { console.log(`SKIP ${target}: no user doc`); continue; }

  // Retry a few times with backoff — an ACTIVE user's doc gets concurrent
  // writes (balance stream etc.) and the tx can abort with ABORTED/contention.
  // Atomic either way: an aborted attempt writes nothing.
  const runGrantTx = () => db.runTransaction(async (tx) => {
    tx.set(userRef, { wheelSpins: FieldValue.increment(count) }, { merge: true });
    const evtRef = db.collection('v2_activity_events').doc();
    tx.set(evtRef, {
      type: 'promo_claimed', userId: uid, walletAddress: uid,
      username: before.username || null, walletType: 'privy', paymentMethod: null,
      quantity: count, tokenIds: [], txHash: null,
      metadata: { promoType: 'admin-extra-spin', source: 'admin-manual-grant', spinsAdded: count, reason: `Boris grant ${new Date().toISOString().slice(0, 10)}` },
      devicePlatform: 'unknown', userAgent: null,
      createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(),
    });
  });
  let granted = false;
  for (let attempt = 1; attempt <= 4 && !granted; attempt++) {
    try { await runGrantTx(); granted = true; }
    catch (e) {
      if (attempt === 4) { console.log(`FAILED ${target} after 4 attempts: ${e.message}`); }
      else await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (!granted) continue;

  const dedupe = `extra-spin-${Date.now()}`;
  await db.collection('marketplace_notifications').doc(`${uid}__${dedupe}`).create({
    wallet: uid, type: 'promo',
    title: count === 1 ? 'Free Spin added!' : `${count} Free Spins added!`,
    message: count === 1
      ? 'A Free Banana Spin was added to your wheel — win up to 20 free drafts. Tap to spin.'
      : `${count} Free Banana Spins were added to your wheel — each wins up to 20 free drafts. Tap to spin.`,
    link: '/banana-wheel', read: false, dedupeKey: dedupe, icon: 'spin',
    createdAt: FieldValue.serverTimestamp(),
  }).catch((e) => console.log(`  bell error: ${e.message}`));
  await rtdb.ref(`userEvents/${uid}`).push({ type: 'notification', ts: Date.now() });

  const after = (await userRef.get()).data();
  console.log(`✓ ${before.username || uid.slice(0, 10)} (${uid.slice(0, 10)}…): wheelSpins ${before.wheelSpins || 0} -> ${after.wheelSpins} (+${count}), bell sent`);
}
await rtdb.goOffline();
process.exit(0);
