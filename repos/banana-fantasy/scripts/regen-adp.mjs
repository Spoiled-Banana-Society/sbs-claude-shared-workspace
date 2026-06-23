// regen-adp.mjs — regenerate the LIVE_ADP block in data/nfl-players.ts from the
// live Firestore `playerStats2026/playerMap` ADP values.
//
// WHY: the draft-room roster panel/tab now read ADP live from the server, but
// the server-side team-card / NFT / OG-image paths still read the bundled
// LIVE_ADP map in data/nfl-players.ts. That map must match Firestore. Whenever
// you reseed ADP (e.g. the prod seed at launch, or a recompute), run this so the
// cards never drift from the live board.
//
// SAFE BY DESIGN: read-only on Firestore (REST GET), and the only thing it
// writes is one line in data/nfl-players.ts — locally. Nothing deploys; you
// still review the diff, run lint, and ship through the normal flow.
//
// USAGE:
//   node scripts/regen-adp.mjs                  # DRY RUN — prints the new block + a diff, writes nothing
//   node scripts/regen-adp.mjs --write          # rewrites the LIVE_ADP line in data/nfl-players.ts
//   node scripts/regen-adp.mjs --project=sbs-staging-env   # override the Firestore project (default below)
//
// AUTH: uses your gcloud access token (no service-account file needed). Make
// sure `gcloud auth print-access-token` works and the account can read the
// target project's Firestore. Override the binary with GCLOUD_BIN if needed.

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'data', 'nfl-players.ts');

const WRITE = process.argv.includes('--write');
const projArg = process.argv.find((a) => a.startsWith('--project='));
// Default to sbs-staging-env: the live "staging-as-prod" build reads
// playerStats2026 from there (isStagingMode is hard-true). Override at launch
// only if the seed target ever changes.
const PROJECT = projArg ? projArg.split('=')[1] : 'sbs-staging-env';

function gcloudToken() {
  const candidates = [process.env.GCLOUD_BIN, 'gcloud', `${process.env.HOME}/google-cloud-sdk/bin/gcloud`].filter(Boolean);
  for (const bin of candidates) {
    try {
      return execSync(`${bin} auth print-access-token`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* try next */ }
  }
  throw new Error('Could not get a gcloud access token. Is gcloud installed + authed? (set GCLOUD_BIN if not on PATH)');
}

async function fetchPlayerMap(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/playerStats2026/playerMap`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore read failed: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const players = j?.fields?.Players?.mapValue?.fields;
  if (!players) throw new Error('playerMap has no Players.mapValue.fields — wrong project or doc?');
  const out = {};
  for (const [id, node] of Object.entries(players)) {
    const adpNode = node?.mapValue?.fields?.ADP;
    const raw = adpNode?.integerValue ?? adpNode?.doubleValue;
    if (raw === undefined) continue; // skip any slot missing ADP
    out[id] = Number(raw);
  }
  return out;
}

/** Parse the existing LIVE_ADP object literal out of data/nfl-players.ts. */
function readCurrentBlock(src) {
  const m = src.match(/const LIVE_ADP: Record<string, number> = (\{[^\n]*\});/);
  if (!m) throw new Error('Could not find the LIVE_ADP line in data/nfl-players.ts');
  return { json: JSON.parse(m[1]), full: m[0] };
}

/** Build the one-line replacement, sorted by ADP asc then playerId for a stable diff. */
function renderBlock(map) {
  const entries = Object.entries(map).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const body = entries.map(([id, adp]) => `"${id}": ${adp}`).join(', ');
  return `const LIVE_ADP: Record<string, number> = { ${body} };`;
}

const token = gcloudToken();
const live = await fetchPlayerMap(token);
const src = readFileSync(FILE, 'utf8');
const current = readCurrentBlock(src);

// Diff (current file vs live Firestore)
const allIds = new Set([...Object.keys(current.json), ...Object.keys(live)]);
const changed = [];
const added = [];
const removed = [];
for (const id of allIds) {
  const c = current.json[id];
  const n = live[id];
  if (c === undefined) added.push(`${id}=${n}`);
  else if (n === undefined) removed.push(`${id}=${c}`);
  else if (c !== n) changed.push(`${id}: ${c} -> ${n}`);
}

console.log(`Firestore project: ${PROJECT}`);
console.log(`live slots: ${Object.keys(live).length}   file slots: ${Object.keys(current.json).length}`);
console.log(`\nCHANGED (${changed.length}):`); changed.slice(0, 50).forEach((l) => console.log('  ' + l));
if (changed.length > 50) console.log(`  …and ${changed.length - 50} more`);
console.log(`ADDED (${added.length}):`, added.join(', ') || 'none');
console.log(`REMOVED (${removed.length}):`, removed.join(', ') || 'none');

if (changed.length === 0 && added.length === 0 && removed.length === 0) {
  console.log('\n✓ Already in sync — file matches live Firestore. Nothing to do.');
  process.exit(0);
}

if (!WRITE) {
  console.log('\nDRY RUN — no file written. Re-run with --write to apply, then run lint/tsc and deploy.');
  process.exit(0);
}

const next = src.replace(current.full, renderBlock(live));
if (next === src) throw new Error('Replacement produced no change — aborting to avoid a silent no-op.');
writeFileSync(FILE, next);
console.log(`\n✓ Wrote ${FILE}. Now: \`npx next lint --file data/nfl-players.ts\`, tsc, review the diff, and deploy.`);
