#!/usr/bin/env node
// SLOW DRAFT CLOCK switch — system_config/slowDraftClock. READ-ONLY unless a flag is given.
//
//   node scripts/_slow-clock-toggle.mjs                 # show current config
//   node scripts/_slow-clock-toggle.mjs --on            # enable (4h + fresh clock at 5am unless already set)
//   node scripts/_slow-clock-toggle.mjs --off           # back to legacy 8h carry-over
//   node scripts/_slow-clock-toggle.mjs --hours 2       # set pick clock (match Underdog); also --minutes 60
//   node scripts/_slow-clock-toggle.mjs --fresh on|off  # fresh full clock at 5am for picks that straddle the pause
//   node scripts/_slow-clock-toggle.mjs --on --start 2026-08-27T12:00:00Z   # arm now, takes effect at that instant (5am PT = 12:00Z in PDT)
//   node scripts/_slow-clock-toggle.mjs --start none                        # clear the gate
//   node scripts/_slow-clock-toggle.mjs --pause-end 7                        # overnight pause ends 7am PT (legacy 5) while active
//
// Applies to EVERY slow draft incl. in-progress ones on their NEXT pick (Go reads
// the doc with a 60s cache; the site's /api/config/slow-clock is CDN-cached 60s).
// ⚠️ --on is the "make it live" action. Richard's call only.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const ref = db.collection('system_config').doc('slowDraftClock');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const after = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const cur = (await ref.get()).data() ?? {};
console.log('current:', JSON.stringify(cur, null, 1));
const patch = {};
if (has('--on')) {
  patch.enabled = true;
  if (!cur.pickLengthSec) patch.pickLengthSec = 4 * 3600;
  if (cur.freshClockAfterPause == null) patch.freshClockAfterPause = true;
  if (!cur.enabledAtIso) patch.enabledAtIso = new Date().toISOString();
}
if (has('--off')) patch.enabled = false;
const hours = after('--hours');
if (hours) patch.pickLengthSec = Math.round(Number(hours) * 3600);
const minutes = after('--minutes');
if (minutes) patch.pickLengthSec = Math.round(Number(minutes) * 60);
const start = after('--start');
if (start) { if (start === 'none') patch.startsAtIso = ''; else { if (!Number.isFinite(Date.parse(start))) { console.error('bad --start'); process.exit(1); } patch.startsAtIso = new Date(start).toISOString(); } }
const pe = after('--pause-end');
if (pe) { const h = Number(pe); if (!Number.isInteger(h) || h < 1 || h > 21) { console.error('--pause-end must be 1..21 (PT hour)'); process.exit(1); } patch.pauseEndHour = h; }
const fresh = after('--fresh');
if (fresh) patch.freshClockAfterPause = fresh === 'on';
if (Object.keys(patch).length) {
  if (patch.pickLengthSec != null && (!(patch.pickLengthSec > 0) || patch.pickLengthSec > 17 * 3600)) {
    console.error('pickLengthSec must be 1s..17h (one active window)'); process.exit(1);
  }
  patch.updatedAtIso = new Date().toISOString();
  await ref.set(patch, { merge: true });
  console.log('patched:', JSON.stringify(patch, null, 1));
  console.log('now:', JSON.stringify((await ref.get()).data(), null, 1));
} else {
  console.log('(read-only — no flags given)');
}
