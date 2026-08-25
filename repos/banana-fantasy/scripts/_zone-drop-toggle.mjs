// GOLDEN TICKETS switch — system_config/zoneDrop.
//   node scripts/_zone-drop-toggle.mjs --status
//   node scripts/_zone-drop-toggle.mjs --on     (stamps sinceIso on first ON)
//   node scripts/_zone-drop-toggle.mjs --off
// Prints every band still 'earning' before flipping so you can see exactly
// what the first cron tick will lock/reveal. READ-ONLY unless --on/--off.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const args = new Set(process.argv.slice(2));
const ref = db.collection('system_config').doc('zoneDrop');
const cur = (await ref.get()).data() ?? {};
console.log('current:', JSON.stringify(cur));

const bands = await db.collection('zone_drop_bands').get();
for (const d of bands.docs) {
  const b = d.data();
  const inst = b.mode === 'instant'
    ? ` mode=instant dealt=${b.seatsDealt ?? 0}/${b.tickets} resolved=${Object.keys(b.resolved ?? {}).length} rollover=${b.rollover ?? 0} seedSource=${b.seedSource ?? '?'}`
    : ' mode=batch';
  console.log(`band ${b.bandId}: status=${b.status} packs=${b.packCount ?? 0} tickets=${b.tickets} window=${b.windowStart} reveal=${b.revealAtMs ? new Date(b.revealAtMs).toISOString() : '-'}${inst}`);
}
if (cur.next) console.log('staged next (applies at the next window):', JSON.stringify(cur.next));

if (args.has('--on')) {
  const patch = { enabled: true, ...(cur.sinceIso ? {} : { sinceIso: new Date().toISOString() }) };
  await ref.set(patch, { merge: true });
  console.log('FLIPPED ON', JSON.stringify(patch));
} else if (args.has('--off')) {
  await ref.set({ enabled: false }, { merge: true });
  console.log('FLIPPED OFF');
} else {
  console.log('(status only — pass --on or --off to flip)');
}
process.exit(0);
