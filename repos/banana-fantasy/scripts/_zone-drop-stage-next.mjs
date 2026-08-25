// ZONE PACKS — stage the next-window rule change (system_config/zoneDrop.next).
//
// Richard 8/25: zone 1 to 30 (Buy 1 Get 1 Spin, 3 JackHOF seats) + 31 to 60
// (Buy 2 Get 1 Spin, 7 seats), packs open the moment the draft fills
// (INSTANT mode), seats lean toward the end of each batch (ramp 1).
// The change is NEVER applied mid-window: it is staged here and applies
// itself at the first fill of the next window (lib/zoneDrop
// applyStagedZoneConfig — webhook primary, cron tick backstop).
//
//   node scripts/_zone-drop-stage-next.mjs --status
//   node scripts/_zone-drop-stage-next.mjs --stage                         # the 8/25 defaults below
//   node scripts/_zone-drop-stage-next.mjs --stage --tiers 30 60 60 --seats 3 7 --instant --ramp 1
//   node scripts/_zone-drop-stage-next.mjs --clear                         # un-stage (nothing applied yet)
//
// READ-ONLY unless --stage / --clear. Richard's green light only.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const after = (f, n = 1) => { const i = args.indexOf(f); return i === -1 ? null : args.slice(i + 1, i + 1 + n); };

const zdRef = db.collection('system_config').doc('zoneDrop');
const bzRef = db.collection('system_config').doc('bonusZone');
const zd = (await zdRef.get()).data() ?? {};
const bz = (await bzRef.get()).data() ?? {};

// Live window (same math as _bonus-zone-toggle).
const t = (await db.collection('drafts').doc('draftTracker').get()).data();
const filled = t.FilledLeaguesCount, rs = t.RollingStartDraft;
let ws = rs; for (const id of [...t.JackpotLeagueIds].sort((a, b) => a - b)) if (id <= filled && id >= ws) ws = id + 1;
const nextPos = filled - ws + 2;

console.log('zoneDrop:', JSON.stringify({ enabled: zd.enabled, instant: zd.instant ?? false, seatsByBand: zd.seatsByBand ?? '[6,4,0] (default)', seatRamp: zd.seatRamp ?? '1 (default)', liveSeats: zd.liveSeats ?? null, appliedWindowStart: zd.appliedWindowStart ?? null }));
console.log('bonusZone tiers:', bz.tier1Through, bz.tier2Through, bz.tier3Through);
console.log('staged next:', zd.next ? JSON.stringify(zd.next) : '(none)');
console.log(`live: filled=${filled} windowStart=${ws} nextPosition=${nextPos}`);

if (has('--stage')) {
  const tiers = (after('--tiers', 3) ?? ['30', '60', '60']).map(Number);
  const seats = (after('--seats', 2) ?? ['3', '7']).map(Number);
  const ramp = Number((after('--ramp') ?? ['1'])[0]);
  const instant = has('--instant') || !has('--batch');
  const next = {
    instant,
    seatsByBand: [seats[0], seats[1], 0],
    tiers: [tiers[0], tiers[1], tiers[2] ?? tiers[1]],
    seatRamp: ramp,
    stagedWindowStart: ws,
    stagedAtIso: new Date().toISOString(),
  };
  await zdRef.set({ next }, { merge: true });
  console.log('STAGED for the window AFTER', ws, '→', JSON.stringify(next));
  console.log('It applies itself at the first fill of the next window (after the next Jackpot hit). Nothing changes until then.');
} else if (has('--clear')) {
  await zdRef.set({ next: FieldValue.delete() }, { merge: true });
  console.log('CLEARED the staged change.');
} else {
  console.log('(status only — pass --stage or --clear)');
}
process.exit(0);
