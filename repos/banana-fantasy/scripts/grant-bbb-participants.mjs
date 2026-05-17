// Retroactively grants bbb{1,2,3}-participant badges based on on-chain
// holders of each past-season collection. Scans ERC-721 Transfer events
// from contract genesis to latest, collects every unique recipient (any
// wallet that ever held a pass — flippers count as "I was there"), and
// idempotently unlocks the matching badge for each.
//
// USAGE
//   1. Fill in BBB1/BBB2/BBB3 contract addresses + chain config below.
//      Boris should have these handy — I couldn't find them in any of
//      the workspace, old-dev backend, or main site repos.
//   2. Set GOOGLE_APPLICATION_CREDENTIALS to a Firebase Admin SA JSON
//      with write access to the v2_users + userBadges collections.
//   3. Optional: SBS_PARTICIPANT_DRY_RUN=1 to print the holder list
//      without writing any badge docs.
//   4. node scripts/grant-bbb-participants.mjs
//
// REQUIRED PACKAGES: ethers (already a frontend dep), firebase-admin
// (used by lib/firebaseAdmin). Run from the banana-fantasy root.

import { ethers } from 'ethers';
import { getAdminFirestore } from '../lib/firebaseAdmin.js';
import { unlockBadge } from '../lib/db.js';

// ────────────────────────────────────────────────────────────────────────
// FILL IN — one entry per season. Each address points at an ERC-721
// contract (the season's draft-pass collection). rpcUrl can be any
// public RPC for that chain; for Base use https://mainnet.base.org, for
// Ethereum any of cloudflare-eth.com / Alchemy / Infura.
// ────────────────────────────────────────────────────────────────────────
const SEASONS = [
  {
    badgeId: 'bbb1-participant',
    address: '0x0000000000000000000000000000000000000000', // TODO BBB1 contract
    rpcUrl:  'https://cloudflare-eth.com',                  // TODO chain RPC
    deployBlock: 0,    // first block to scan from (contract deploy block)
    chunk: 50_000,     // event-fetch block range per request
  },
  {
    badgeId: 'bbb2-participant',
    address: '0x0000000000000000000000000000000000000000', // TODO BBB2
    rpcUrl:  'https://cloudflare-eth.com',
    deployBlock: 0,
    chunk: 50_000,
  },
  {
    badgeId: 'bbb3-participant',
    address: '0x0000000000000000000000000000000000000000', // TODO BBB3
    rpcUrl:  'https://cloudflare-eth.com',
    deployBlock: 0,
    chunk: 50_000,
  },
];

const DRY_RUN = process.env.SBS_PARTICIPANT_DRY_RUN === '1';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

async function collectHolders(season) {
  const provider = new ethers.JsonRpcProvider(season.rpcUrl);
  const latest = await provider.getBlockNumber();
  const holders = new Set();
  let from = season.deployBlock;
  while (from <= latest) {
    const to = Math.min(from + season.chunk - 1, latest);
    process.stdout.write(`  [${season.badgeId}] scanning ${from}–${to}…\r`);
    let logs;
    try {
      logs = await provider.getLogs({
        address: season.address,
        topics: [TRANSFER_TOPIC],
        fromBlock: from,
        toBlock: to,
      });
    } catch (err) {
      // Most RPCs cap getLogs at 10k blocks — back off and retry.
      if (season.chunk > 2_000) {
        season.chunk = Math.max(2_000, Math.floor(season.chunk / 2));
        console.log(`\n  rate-limited, dropping chunk to ${season.chunk}`);
        continue;
      }
      throw err;
    }
    for (const log of logs) {
      // ERC-721 Transfer: topics[2] = to address (32-byte padded).
      const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26));
      if (toAddr.toLowerCase() !== ZERO_ADDR) holders.add(toAddr.toLowerCase());
    }
    from = to + 1;
  }
  process.stdout.write('\n');
  return holders;
}

async function main() {
  console.log('[grant-bbb-participants] dry-run:', DRY_RUN);
  const db = DRY_RUN ? null : getAdminFirestore();

  for (const season of SEASONS) {
    if (season.address === '0x0000000000000000000000000000000000000000') {
      console.warn(`[${season.badgeId}] SKIP — contract address not set`);
      continue;
    }
    console.log(`\n[${season.badgeId}] scanning ${season.address}`);
    const holders = await collectHolders(season);
    console.log(`[${season.badgeId}] ${holders.size} unique wallets ever held a pass`);

    if (DRY_RUN) {
      for (const h of holders) console.log(`  ${h}`);
      continue;
    }

    let granted = 0;
    let skipped = 0;
    for (const wallet of holders) {
      // unlockBadge is transactionally idempotent — second call returns
      // false. So this is safe to re-run.
      const didUnlock = await unlockBadge(wallet, season.badgeId, {
        source: 'on-chain-holder-sweep',
        contract: season.address,
      });
      if (didUnlock) granted++;
      else skipped++;
    }
    console.log(`[${season.badgeId}] granted ${granted}, already-had ${skipped}`);
    void db; // silence unused warn when DRY_RUN is false but db isn't used otherwise
  }
}

main().catch((err) => {
  console.error('[grant-bbb-participants] failed:', err);
  process.exitCode = 1;
});
