#!/usr/bin/env node
// BONUS ZONE switch — system_config/bonusZone. READ-ONLY unless a flag is given.
//
//   node scripts/_bonus-zone-toggle.mjs                 # show current config + live view
//   node scripts/_bonus-zone-toggle.mjs --on            # enable + stamp launchAtIso=now (if unset)
//   node scripts/_bonus-zone-toggle.mjs --off           # disable (entries/grants untouched)
//   node scripts/_bonus-zone-toggle.mjs --tiers 33 69   # set tier cutoffs
//   node scripts/_bonus-zone-toggle.mjs --grandfather 1234,5678   # ADD token ids to the allowlist
//   node scripts/_bonus-zone-toggle.mjs --launch 2026-08-25T00:00:00Z  # set/override launch stamp
//
// ⚠️ --on is the "make it live" action. Richard's call only.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const ref = db.collection('system_config').doc('bonusZone');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const after = (f, n = 1) => { const i = args.indexOf(f); return i === -1 ? null : args.slice(i + 1, i + 1 + n); };

const cur = (await ref.get()).data() ?? {};
console.log('current:', JSON.stringify(cur, null, 1));

const patch = {};
if (has('--on')) { patch.enabled = true; if (!cur.launchAtIso) patch.launchAtIso = new Date().toISOString(); }
if (has('--off')) patch.enabled = false;
const tiers = after('--tiers', 2);
if (tiers) { patch.tier1Through = Number(tiers[0]); patch.tier2Through = Number(tiers[1]); }
const gf = after('--grandfather');
if (gf) patch.grandfatherTokenIds = Array.from(new Set([...(cur.grandfatherTokenIds ?? []), ...gf[0].split(',').map((s) => s.trim()).filter(Boolean)]));
const launch = after('--launch');
if (launch) patch.launchAtIso = new Date(launch[0]).toISOString();

if (Object.keys(patch).length) {
  patch.updatedAtIso = new Date().toISOString();
  await ref.set(patch, { merge: true });
  console.log('written:', JSON.stringify(patch, null, 1));
}

// Live view (what the pill would show right now).
const t = (await db.collection('drafts').doc('draftTracker').get()).data();
const filled = t.FilledLeaguesCount, rs = t.RollingStartDraft;
let ws = rs; for (const id of [...t.JackpotLeagueIds].sort((a, b) => a - b)) if (id <= filled && id >= ws) ws = id + 1;
const pos = filled - ws + 2; // next draft's window position
const merged = { ...cur, ...patch };
const t1 = merged.tier1Through ?? 33, t2 = merged.tier2Through ?? 69;
const tier = pos <= t1 ? `Buy 1 Get 1 (${t1 - pos + 1} left)` : pos <= t2 ? `Buy 2 Get 1 (${t2 - pos + 1} left)` : 'zone closed';
console.log(`live: filled=${filled} windowStart=${ws} nextPosition=${pos} → ${tier} · enabled=${merged.enabled === true}`);
process.exit(0);
