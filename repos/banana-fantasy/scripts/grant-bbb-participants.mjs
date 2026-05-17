// Retroactively grants bbb{1,2,3}-participant badges based on on-chain
// holders of each past-season collection. Scans ERC-721 Transfer events
// from a conservative pre-deploy block to latest, collects every unique
// recipient (any wallet that ever held a pass — flippers count as "I
// was there"), and idempotently writes the matching badge unlock to
// Firestore at v2_users/{wallet}/badges/{badgeId}.
//
// USAGE
//   1. cd ~/sbs-claude-shared-workspace/repos/banana-fantasy
//   2. (Optional but strongly recommended) dry-run first to print the
//      holder counts and a sample before touching Firestore:
//         SBS_PARTICIPANT_DRY_RUN=1 node scripts/grant-bbb-participants.mjs
//   3. (Optional) SBS_ETH_RPC=<alchemy/infura url> to skip publicnode
//      rate limits. Default ethereum-rpc.publicnode.com works but the
//      scan can take 20-40 min across all three collections.
//   4. For the real grant, the script reads the Firebase SA from
//      .env.production (FIREBASE_SERVICE_ACCOUNT_JSON, base64-encoded —
//      same as check-merkle-round.mjs):
//         node scripts/grant-bbb-participants.mjs
//
// All three contracts verified via eth_call(name()) →
// "Banana Best Ball Season 1" / "SBS Draft Token Season 2/3" and the
// totalSupply matches DEV_FIXES_LOG (1,281 / 5,133 / 12,150).

import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ETH_RPC = process.env.SBS_ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const DRY_RUN = process.env.SBS_PARTICIPANT_DRY_RUN === '1';

const SEASONS = [
  {
    badgeId: 'bbb1-participant',
    address: '0x82194174d56b6df894460e7754a9cc69a0c1707d',
    rpcUrl:  ETH_RPC,
    deployBlock: 15_000_000, // ~June 2022 floor (season launched fall 2022)
    chunk: 10_000,
  },
  {
    badgeId: 'bbb2-participant',
    address: '0x6b417828051328caef5b4e0bfe8325962ec8fb17',
    rpcUrl:  ETH_RPC,
    deployBlock: 17_000_000, // ~April 2023 floor
    chunk: 10_000,
  },
  {
    badgeId: 'bbb3-participant',
    address: '0x2bff6f4284774836d867ced2e9b96c27aaee55b7',
    rpcUrl:  ETH_RPC,
    deployBlock: 19_500_000, // ~April 2024 floor
    chunk: 10_000,
  },
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Known marketplace + bridge contracts that briefly hold NFTs mid-trade.
// Filtered out so they don't earn participant badges they can't display.
const SKIP_ADDRS = new Set([
  '0x00000000006c3852cbef3e08e8df289169ede581', // OpenSea Seaport 1.1
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', // OpenSea Seaport 1.5
  '0x0000000000000068f116a894984e2db1123eb395', // OpenSea Seaport 1.6
  '0x7be8076f4ea4a4ad08075c2508e481d6c946d12b', // OpenSea Wyvern v2
  '0x7f268357a8c2552623316e2562d90e642bb538e5', // OpenSea Wyvern v1
  '0x000000000000ad05ccc4f10045630fb830b95127', // Blur Marketplace
  '0x39da41747a83aee658334415666f3ef92dd0d541', // Blur Pool
  '0x59728544b08ab483533076417fbbb2fd0b17ce3a', // LooksRare
  '0x9757f2d2b135150bbeb65308d4a91804107cd8d6', // X2Y2
  '0x00000000a50bb64b4bbeceb18715748dface08af', // Reservoir
]);

async function collectHolders(season) {
  const provider = new ethers.JsonRpcProvider(season.rpcUrl);
  const latest = await provider.getBlockNumber();
  const holders = new Set();
  let from = season.deployBlock;
  let chunk = season.chunk;
  while (from <= latest) {
    const to = Math.min(from + chunk - 1, latest);
    process.stdout.write(`  [${season.badgeId}] ${from}-${to} (${holders.size} holders so far)\r`);
    let logs;
    try {
      logs = await provider.getLogs({
        address: season.address,
        topics: [TRANSFER_TOPIC],
        fromBlock: from,
        toBlock: to,
      });
    } catch (err) {
      // Most public RPCs cap getLogs at 10k blocks or limit response
      // size. Back off and retry the same range.
      if (chunk > 2_000) {
        chunk = Math.max(2_000, Math.floor(chunk / 2));
        process.stdout.write(`\n  rate-limited, dropping chunk to ${chunk}\n`);
        continue;
      }
      throw err;
    }
    for (const log of logs) {
      // ERC-721 Transfer: topics[2] = to address (32-byte left-padded).
      const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
      if (toAddr === ZERO_ADDR) continue;
      if (SKIP_ADDRS.has(toAddr)) continue;
      holders.add(toAddr);
    }
    from = to + 1;
  }
  process.stdout.write('\n');
  return holders;
}

function loadFirebase() {
  // Match lib/firebaseAdmin.ts: env var FIREBASE_SERVICE_ACCOUNT_JSON
  // first (raw JSON or base64), else fall back to the hardcoded staging
  // SA. We pull the fallback by reading the source file so we don't have
  // to duplicate the long base64 blob here.
  let saSource = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!saSource) {
    const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
    const m = src.match(/STAGING_SA_B64\s*=\s*'([A-Za-z0-9+/=]+)'/);
    if (!m) throw new Error('Could not locate STAGING_SA_B64 in lib/firebaseAdmin.ts');
    saSource = m[1];
  }
  let sa;
  try { sa = JSON.parse(saSource); }
  catch { sa = JSON.parse(Buffer.from(saSource, 'base64').toString('utf8')); }
  console.log(`[grant-bbb-participants] Firestore project: ${sa.project_id}`);
  initializeApp({ credential: cert(sa) });
  return getFirestore();
}

// Mirrors lib/db-firestore.ts unlockBadge — transactional, idempotent.
// Writes to v2_users/{wallet}/badges/{badgeId}. Returns true on first
// unlock, false if the badge was already unlocked.
async function unlockBadge(db, wallet, badgeId, source) {
  const ref = db
    .collection('v2_users')
    .doc(wallet)
    .collection('badges')
    .doc(badgeId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? snap.data() : null;
    if (existing && existing.unlocked) return false;
    tx.set(
      ref,
      {
        id: badgeId,
        unlocked: true,
        unlockedAt: new Date().toISOString(),
        ...(source ? { source } : {}),
      },
      { merge: true },
    );
    return true;
  });
}

async function main() {
  console.log(`[grant-bbb-participants] dry-run: ${DRY_RUN}`);
  console.log(`[grant-bbb-participants] RPC: ${ETH_RPC}`);

  const db = DRY_RUN ? null : loadFirebase();

  for (const season of SEASONS) {
    console.log(`\n[${season.badgeId}] scanning ${season.address}`);
    const holders = await collectHolders(season);
    console.log(`[${season.badgeId}] ${holders.size} unique wallets ever held a pass`);

    if (DRY_RUN) {
      const sample = [...holders].slice(0, 10);
      console.log(`  sample (first 10): ${sample.join(', ')}`);
      continue;
    }

    let granted = 0;
    let skipped = 0;
    let i = 0;
    for (const wallet of holders) {
      i++;
      if (i % 50 === 0) process.stdout.write(`  ${i}/${holders.size}…\r`);
      try {
        const ok = await unlockBadge(db, wallet, season.badgeId, {
          source: 'on-chain-holder-sweep',
          contract: season.address,
        });
        if (ok) granted++;
        else skipped++;
      } catch (err) {
        console.error(`\n  unlock failed for ${wallet}:`, err.message);
      }
    }
    process.stdout.write('\n');
    console.log(`[${season.badgeId}] granted ${granted}, already-had ${skipped}`);
  }
}

main().catch((err) => {
  console.error('[grant-bbb-participants] failed:', err);
  process.exitCode = 1;
});
