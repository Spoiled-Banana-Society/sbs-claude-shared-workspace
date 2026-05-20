/**
 * Unified log reader for Banana Fantasy staging. Reads both Firestore
 * collections — v2_error_events (errors) and v2_debug_events (debug
 * breadcrumbs) — so you can diagnose any reported bug from the CLI
 * without devtools.
 *
 * Zero config: the staging service account is auto-decoded from
 * lib/firebaseAdmin.ts. Override with SA_PATH=/path/to/sa.json if needed.
 *
 * Usage:
 *   node scripts/logs.mjs errors [--area=draft] [--wallet=0x..] [--minutes=120] [--limit=50]
 *   node scripts/logs.mjs session <sessionId>
 *   node scripts/logs.mjs trace  [--tag=draft#] [--wallet=0x..] [--minutes=30] [--limit=200]
 *
 * Examples:
 *   node scripts/logs.mjs errors --area=draft --minutes=60
 *   node scripts/logs.mjs session s-1716100000000-ab12cd
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RTDB_URL = 'https://sbs-staging-env-default-rtdb.firebaseio.com';

/* ── Service account bootstrap ─────────────────────────────────── */
function loadServiceAccount() {
  if (process.env.SA_PATH) {
    return JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
  }
  // Auto-decode the staging SA embedded in lib/firebaseAdmin.ts.
  const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
  const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
  if (!m) {
    console.error('Could not find STAGING_SA_B64 in lib/firebaseAdmin.ts. Set SA_PATH instead.');
    process.exit(1);
  }
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
  databaseURL: RTDB_URL,
});
const db = admin.firestore();

/* ── Arg parsing ───────────────────────────────────────────────── */
const [cmd, ...rest] = process.argv.slice(2);
const positional = [];
const flags = {};
for (const a of rest) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
  else positional.push(a);
}

/* ── Area derivation (mirror of lib/logSources.ts) ─────────────── */
const PREFIX_TO_AREA = { ws: 'draft', 'card-mint': 'payment', go: 'backend', server: 'backend', api: 'backend', client: 'other' };
const KNOWN_AREAS = ['draft', 'payment', 'promo', 'marketplace', 'wheel', 'auth', 'kyc', 'onramp', 'offramp', 'referral', 'profile', 'prizes', 'admin', 'backend', 'global', 'other'];
function areaForSource(source) {
  if (!source) return 'other';
  if (String(source).toLowerCase().startsWith('go:')) return 'backend';
  const prefix = String(source).split('.')[0].toLowerCase();
  if (PREFIX_TO_AREA[prefix]) return PREFIX_TO_AREA[prefix];
  if (KNOWN_AREAS.includes(prefix)) return prefix;
  return 'other';
}

/* ── ANSI colors ───────────────────────────────────────────────── */
const C = { red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', dim: '\x1b[2m', reset: '\x1b[0m' };

/* ── Commands ──────────────────────────────────────────────────── */
async function cmdErrors() {
  const area = flags.area || null;
  const wallet = (flags.wallet || '').toLowerCase();
  const minutes = Number(flags.minutes || 240);
  const limit = Number(flags.limit || 50);
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

  const snap = await db.collection('v2_error_events')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();

  const rows = snap.docs.map((d) => d.data()).filter((d) => {
    if (d.timestamp && d.timestamp < cutoff) return false;
    if (area && areaForSource(d.source) !== area) return false;
    if (wallet && (d.actor || '').toLowerCase() !== wallet) return false;
    return true;
  }).slice(0, limit);

  console.log(`\n=== ${rows.length} errors (last ${minutes} min${area ? `, area=${area}` : ''}${wallet ? `, wallet=${wallet}` : ''}) ===\n`);
  for (const d of rows) {
    const time = (d.timestamp || '').slice(0, 19).replace('T', ' ');
    const ar = areaForSource(d.source).padEnd(11);
    console.log(`${C.gray}${time}${C.reset} ${C.cyan}[${ar}]${C.reset} ${C.red}${d.source}${C.reset}`);
    console.log(`  ${d.message || ''}`);
    const meta = [];
    if (d.route) meta.push(`route=${d.route}`);
    if (d.actor) meta.push(`actor=${d.actor.slice(0, 12)}`);
    if (d.sessionId) meta.push(`session=${d.sessionId}`);
    if (meta.length) console.log(`  ${C.dim}${meta.join('  ')}${C.reset}`);
    console.log('');
  }
  if (rows.some((d) => d.sessionId)) {
    console.log(`${C.dim}Tip: node scripts/logs.mjs session <sessionId> — full trace for one user.${C.reset}\n`);
  }
}

async function cmdSession() {
  const sessionId = positional[0];
  if (!sessionId) {
    console.error('Usage: node scripts/logs.mjs session <sessionId>');
    process.exit(1);
  }

  const [errSnap, traceSnap] = await Promise.all([
    db.collection('v2_error_events').where('sessionId', '==', sessionId).limit(500).get(),
    db.collection('v2_debug_events').where('sessionId', '==', sessionId).limit(2000).get(),
  ]);

  // Interleave errors + breadcrumbs on one timeline.
  const items = [];
  for (const doc of errSnap.docs) {
    const d = doc.data();
    items.push({ t: d.timestamp || '', kind: 'error', d });
  }
  for (const doc of traceSnap.docs) {
    const d = doc.data();
    items.push({ t: d.serverTs || '', kind: 'trace', d });
  }
  items.sort((a, b) => a.t.localeCompare(b.t));

  console.log(`\n=== session ${sessionId} — ${errSnap.size} errors, ${traceSnap.size} breadcrumbs ===\n`);
  for (const it of items) {
    const time = (it.t || '').slice(11, 23);
    if (it.kind === 'error') {
      console.log(`${C.gray}${time}${C.reset} ${C.red}● ERROR ${it.d.source}${C.reset}  ${it.d.message || ''}`);
    } else {
      const payload = it.d.payload ? JSON.stringify(it.d.payload) : '';
      console.log(`${C.gray}${time}${C.reset} ${C.dim}· ${it.d.tag}.${it.d.event}${C.reset}  ${payload}`);
    }
  }
  console.log('');
}

async function cmdTrace() {
  const tag = flags.tag || null;
  const wallet = (flags.wallet || '').toLowerCase();
  const minutes = Number(flags.minutes || 30);
  const limit = Number(flags.limit || 200);
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

  const snap = await db.collection('v2_debug_events')
    .where('serverTs', '>=', cutoff)
    .orderBy('serverTs', 'asc')
    .limit(2000)
    .get();

  const rows = snap.docs.map((d) => d.data()).filter((d) => {
    if (tag && d.tag !== tag) return false;
    if (wallet && (d.wallet || '').toLowerCase() !== wallet) return false;
    return true;
  }).slice(-limit);

  console.log(`\n=== ${rows.length} breadcrumbs (last ${minutes} min${tag ? `, tag=${tag}` : ''}${wallet ? `, wallet=${wallet}` : ''}) ===\n`);
  for (const d of rows) {
    const time = (d.serverTs || '').slice(11, 23);
    const sess = d.sessionId ? d.sessionId.slice(0, 8) : 'no-sess';
    const w = d.wallet ? d.wallet.slice(0, 10) : 'no-wallet';
    const path = d.path ? `[${d.path}] ` : '';
    const payload = d.payload ? JSON.stringify(d.payload) : '';
    console.log(`${C.gray}${time}${C.reset} ${sess} ${w} ${path}${d.tag}.${d.event}  ${C.dim}${payload}${C.reset}`);
  }
  console.log('');
}

/* ── Dispatch ──────────────────────────────────────────────────── */
try {
  if (cmd === 'errors') await cmdErrors();
  else if (cmd === 'session') await cmdSession();
  else if (cmd === 'trace') await cmdTrace();
  else {
    console.log('Usage:');
    console.log('  node scripts/logs.mjs errors  [--area=] [--wallet=] [--minutes=240] [--limit=50]');
    console.log('  node scripts/logs.mjs session <sessionId>');
    console.log('  node scripts/logs.mjs trace   [--tag=] [--wallet=] [--minutes=30] [--limit=200]');
  }
  process.exit(0);
} catch (err) {
  console.error('logs.mjs failed:', err?.message || err);
  process.exit(1);
}
