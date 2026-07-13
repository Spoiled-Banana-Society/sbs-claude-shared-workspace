#!/usr/bin/env node
/**
 * Snapshot every BBB3 holder from Ethereum mainnet into Firestore + a JSON file.
 *
 * Returning-user status is normally a live on-chain check at login (see
 * hooks/useAuth.tsx). This script materialises the full holder list so the
 * admin can SEE who is a returning player and cross-check that they're treated
 * correctly. Re-run whenever you want a fresh snapshot.
 *
 * Source: Alchemy NFT API `getOwnersForContract` on eth-mainnet. Reuses the
 * Alchemy key already in .env.local (NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL — same key
 * works across networks, we just swap the host). Falls back to nothing if the
 * key is missing; pass ALCHEMY_ETH_RPC_URL to override.
 *
 * Zero config: staging service account auto-decoded from lib/firebaseAdmin.ts
 * (same as scripts/logs.mjs). Override with SA_PATH=/path/to/sa.json.
 *
 * Usage: node scripts/snapshot-bbb3-holders.mjs
 */
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RTDB_URL = 'https://sbs-staging-env-default-rtdb.firebaseio.com';

const BBB3_CONTRACT = '0x2BfF6f4284774836d867CEd2e9B96c27aAee55B7'; // BBB3, Eth mainnet
const BURN_ZERO = '0x0000000000000000000000000000000000000000';
const BURN_DEAD = '0x000000000000000000000000000000000000dead';
const SNAPSHOT_DOC = 'bbb3_holders/_snapshot';
const JSON_OUT = join(ROOT, 'public', 'data', 'bbb3-holders.json');

/* ── Service account bootstrap (mirror of scripts/logs.mjs) ──────── */
function loadServiceAccount() {
  if (process.env.SA_PATH) return JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
  const src = readFileSync(join(ROOT, 'lib', 'firebaseAdmin.ts'), 'utf8');
  const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
  if (!m) {
    console.error('Could not find STAGING_SA_B64 in lib/firebaseAdmin.ts. Set SA_PATH instead.');
    process.exit(1);
  }
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

/* ── Alchemy NFT API base for Eth mainnet ────────────────────────── */
function alchemyEthNftBase() {
  if (process.env.ALCHEMY_ETH_RPC_URL) {
    const m = /^(https?:\/\/[^/]+)\/v2\/([^/?#]+)/.exec(process.env.ALCHEMY_ETH_RPC_URL.trim());
    if (m) return `${m[1]}/nft/v3/${m[2]}`;
  }
  // Pull the key out of the Base RPC URL in .env.local and swap the host.
  let envFile = '';
  try { envFile = readFileSync(join(ROOT, '.env.local'), 'utf8'); } catch { /* ignore */ }
  const rpc = (process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL
    || (/NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL=(.+)/.exec(envFile)?.[1] ?? '')).trim().replace(/^["']|["']$/g, '');
  const m = /\/v2\/([^/?#]+)/.exec(rpc);
  if (!m) return null;
  return `https://eth-mainnet.g.alchemy.com/nft/v3/${m[1]}`;
}

async function fetchAllHolders() {
  const base = alchemyEthNftBase();
  if (!base) {
    console.error('No Alchemy key found. Set ALCHEMY_ETH_RPC_URL or NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL.');
    process.exit(1);
  }
  const owners = new Set();
  let pageKey;
  for (let i = 0; i < 200; i++) {
    const params = new URLSearchParams({ contractAddress: BBB3_CONTRACT, withTokenBalances: 'false' });
    if (pageKey) params.set('pageKey', pageKey);
    const res = await fetch(`${base}/getOwnersForContract?${params}`, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.error(`Alchemy ${res.status}: ${await res.text().catch(() => '')}`);
      process.exit(1);
    }
    const body = await res.json();
    for (const o of body.owners ?? []) {
      const w = String(o).toLowerCase();
      if (w === BURN_ZERO || w === BURN_DEAD) continue; // skip burned tokens
      owners.add(w);
    }
    process.stdout.write(`\r  fetched ${owners.size} owners…`);
    if (!body.pageKey) break;
    pageKey = body.pageKey;
  }
  process.stdout.write('\n');
  return [...owners];
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()), databaseURL: RTDB_URL });
  const db = admin.firestore();

  console.log(`Snapshotting BBB3 holders (${BBB3_CONTRACT}) from Eth mainnet…`);
  const wallets = await fetchAllHolders();
  const snapshotAt = new Date().toISOString();
  console.log(`Found ${wallets.length} holder wallets.`);

  await db.doc(SNAPSHOT_DOC).set({ wallets, count: wallets.length, contract: BBB3_CONTRACT, snapshotAt });
  console.log(`Wrote Firestore ${SNAPSHOT_DOC}.`);

  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ contract: BBB3_CONTRACT, count: wallets.length, snapshotAt, wallets }, null, 2));
  console.log(`Wrote ${JSON_OUT}.`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
