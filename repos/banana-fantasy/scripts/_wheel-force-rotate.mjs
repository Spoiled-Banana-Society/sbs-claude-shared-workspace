// Set (or just inspect) the one-shot forceRotate flag the wheel-period
// keeper consumes (system_config/wheelPeriodState.forceRotate). Used to move
// the live wheel onto a new wedge-set generation: the keeper's next 5-min
// tick closes+reveals the current period and opens the next one with the
// currently-deployed template. Usage:
//   node scripts/_wheel-force-rotate.mjs         # inspect only
//   node scripts/_wheel-force-rotate.mjs --set   # arm the rotation
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Same embedded staging SA the frontend's firebaseAdmin fallback uses.
const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const b64 = src.match(/STAGING_SA_B64 = '([^']+)'/)[1];
const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const stateRef = db.collection('system_config').doc('wheelPeriodState');
const state = (await stateRef.get()).data();
console.log('wheelPeriodState:', JSON.stringify(state));
const cur = state?.currentPeriodNumber;
if (cur) {
  const p = (await db.collection('wheel_periods').doc(String(cur)).get()).data();
  console.log(`period ${cur}: status=${p?.status} spins=${p?.spinCount} hasJackhof=${p?.hasJackhof}`);
  console.log('wedge order:', (p?.segmentsSnapshot || []).map((s) => s.id).join(' · '));
}

if (process.argv.includes('--set')) {
  await stateRef.set({ forceRotate: true }, { merge: true });
  console.log('forceRotate flag SET — keeper rolls on its next 5-min tick.');
}
process.exit(0);
