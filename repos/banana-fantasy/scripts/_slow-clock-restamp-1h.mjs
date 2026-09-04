#!/usr/bin/env node
// Re-stamp the CURRENT pick of every active slow draft to the 1h clock (Richard 2026-09-03).
// Why: Go stamps pickEndTime when a pick is armed, so picks armed before the 1h flip carry a
// "4h at 9am" clock. This rewrites them to what the engine would arm RIGHT NOW under the 1h rule
// (in the pause → 9am PT next active + 1h = 10am; daytime → now + 1h, straddling 10pm → 9am + 1h).
// Only touches picks whose pickEndTime is LATER than the target (never extends a clock). Idempotent.
// The original Cloud Task fires at the old pickEndTime and no-ops ("Pick already completed");
// the dead-clock-kick cron autopicks ~3 min after the new pickEndTime if the user doesn't pick.
// DRY unless APPLY=1.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rtdb = admin.database();
const DRY = process.env.APPLY !== '1';
const LANES = ['2026-slow-draft-', '2025-slow-draft-'];
const NEWEST = 400;
const PAUSE_START = 22;

const cfg = (await db.doc('system_config/slowDraftClock').get()).data() ?? {};
const PREVIEW = process.env.PREVIEW === '1'; // simulate the 1h/9am config before the flip (dry only)
const PICK_SEC = PREVIEW ? 3600 : (Number(cfg.pickLengthSec) || 3600);
const PAUSE_END = PREVIEW ? 9 : (Number(cfg.pauseEndHour) || 9);
const fresh = cfg.freshClockAfterPause !== false;
console.log(`project=${sa.project_id} config: pickLengthSec=${PICK_SEC} pauseEndHour=${PAUSE_END} fresh=${fresh} enabled=${cfg.enabled} startsAt=${cfg.startsAtIso || ''} dry=${DRY}`);
if (PREVIEW && !DRY) { console.error('PREVIEW is dry-only'); process.exit(1); }
if (!PREVIEW && (Number(cfg.pickLengthSec) || 0) !== 3600) { console.error('refusing: config pickLengthSec is not 3600 — flip the switch first'); process.exit(1); }
if (!PREVIEW && cfg.startsAtIso && Date.parse(cfg.startsAtIso) > Date.now()) { console.error('refusing: startsAtIso is in the future (switch reads OFF)'); process.exit(1); }

// --- PT helpers (port of Go slowDraftPickEndUnixOpts) ---
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
function pt(ms) { const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day, sod: +p.hour * 3600 + +p.minute * 60 + +p.second }; }
function ptInstant(y, m, d, hour) { // ms for y-m-d hour:00 PT
  let guess = Date.UTC(y, m - 1, d, hour + 7); // PDT guess
  for (let i = 0; i < 3; i++) { const q = pt(guess); const diff = (Date.UTC(q.y, q.m - 1, q.d, Math.floor(q.sod / 3600), (q.sod % 3600) / 60) - Date.UTC(y, m - 1, d, hour)); if (!diff) break; guess -= diff; }
  return guess;
}
function nextActive(ms) { const p = pt(ms); if (p.sod >= PAUSE_START * 3600) { const n = ptInstant(p.y, p.m, p.d, 0) + 24 * 3600e3; const q = pt(n); return ptInstant(q.y, q.m, q.d, PAUSE_END); } if (p.sod < PAUSE_END * 3600) return ptInstant(p.y, p.m, p.d, PAUSE_END); return ms; }
function pickEndMs(fromMs) {
  let cur = nextActive(fromMs); let remaining = PICK_SEC * 1000; const canFresh = fresh && PICK_SEC <= (PAUSE_START - PAUSE_END) * 3600;
  for (let guard = 0; guard < 10; guard++) {
    const p = pt(cur); const close = ptInstant(p.y, p.m, p.d, PAUSE_START); const avail = close - cur;
    if (avail <= 0) { cur = nextActive(close); continue; }
    if (remaining <= avail) return cur + remaining;
    remaining = canFresh ? PICK_SEC * 1000 : remaining - avail;
    cur = nextActive(close);
  }
  return cur;
}
const nowMs = Date.now(); const nowSec = Math.floor(nowMs / 1000);
const targetEnd = Math.floor(pickEndMs(nowMs) / 1000);
console.log(`now=${new Date(nowMs).toISOString()} → 1h-rule pickEnd=${new Date(targetEnd * 1000).toISOString()} (${new Date(targetEnd * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT)`);

const token = await admin.app().options.credential.getAccessToken();
const res = await fetch(`https://sbs-staging-env-default-rtdb.firebaseio.com/drafts.json?shallow=true&access_token=${encodeURIComponent(token.access_token)}`);
const all = Object.keys((await res.json()) ?? {});
const ids = [];
for (const lane of LANES) {
  const nums = all.filter((k) => k.startsWith(lane) && /^\d+$/.test(k.slice(lane.length))).map((k) => Number(k.slice(lane.length))).sort((a, b) => b - a).slice(0, NEWEST);
  for (const n of nums) ids.push(`${lane}${n}`);
}
let active = 0, changed = 0, skipped = 0;
for (const id of ids) {
  const rt = (await rtdb.ref(`drafts/${id}/realTimeDraftInfo`).get()).val();
  if (!rt || rt.isDraftComplete || rt.isDraftClosed) continue;
  if (!rt.pickEndTime || !rt.draftStartTime || nowSec < rt.draftStartTime) continue;
  if (!rt.pickNumber || !rt.currentDrafter) continue;
  active++;
  const line = `${id} pick ${rt.pickNumber} drafter ${String(rt.currentDrafter).slice(0, 8)} pickLength=${rt.pickLength} end=${new Date(rt.pickEndTime * 1000).toISOString()}`;
  if (rt.pickEndTime <= targetEnd && Number(rt.pickLength) === PICK_SEC) { skipped++; console.log(`  ok    ${line}`); continue; }
  if (rt.pickEndTime <= targetEnd) { skipped++; console.log(`  keep  ${line} (ends before target; pickLength label only would change — leaving)`); continue; }
  changed++;
  console.log(`  RESTAMP ${line} → start=${new Date(nowSec * 1000).toISOString()} end=${new Date(targetEnd * 1000).toISOString()} pickLength=${PICK_SEC}`);
  if (!DRY) await rtdb.ref(`drafts/${id}/realTimeDraftInfo`).update({ pickStartTime: nowSec, pickEndTime: targetEnd, pickLength: PICK_SEC });
}
console.log(`active=${active} restamped=${changed} untouched=${skipped} dry=${DRY}`);
process.exit(0);
