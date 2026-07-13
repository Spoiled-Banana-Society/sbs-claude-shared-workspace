// Deploy SBSDraftPassBBB4V2 to Base mainnet, initialize it, and verify the
// conduit auto-approval on-chain. One command, idempotent-ish (re-running
// deploys a fresh contract — only run once).
//
//   1. Compile artifacts must exist (npx solc … -o /tmp/bbb4v2-build, done).
//   2. Key: BBB4_OWNER_PRIVATE_KEY from env, or pulled .env file at
//      /tmp/bbb4v2-build/.env.vercel. NEVER printed.
//
// Run:  cd ~/banana-fantasy && npx vercel env pull /tmp/bbb4v2-build/.env.vercel --environment=production --yes && node scripts/_deploy-bbb4v2.mjs

import { readFileSync } from 'node:fs';
import { createWalletClient, createPublicClient, http, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const RPC = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OPENSEA_CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71';
const BASE_URI = 'https://banana-fantasy-sbs.vercel.app/api/nft/metadata/';
const BUILD = '/tmp/bbb4v2-build';

async function loadKey() {
  let raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) {
    // Local gitignored env file (never synced/deployed/committed) — the
    // place to paste the owner key once. Vercel marks the var Sensitive
    // (not pullable) and Cloud Run doesn't expose it, so local it is.
    const { default: dotenv } = await import('dotenv');
    for (const file of [`${process.env.HOME}/banana-fantasy/.env.local`, `${BUILD}/.env.vercel`]) {
      try {
        const parsed = dotenv.parse(readFileSync(file, 'utf8'));
        raw = parsed.BBB4_OWNER_PRIVATE_KEY?.trim();
        if (raw) break;
      } catch { /* try next */ }
    }
  }
  if (!raw) {
    throw new Error(
      'BBB4_OWNER_PRIVATE_KEY not found. Add this line to ~/banana-fantasy/.env.local (gitignored, never deployed):\n' +
      '  BBB4_OWNER_PRIVATE_KEY=<the owner key>\n' +
      'then rerun: bash ~/banana-fantasy/scripts/_deploy-bbb4v2.sh',
    );
  }
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

const abi = JSON.parse(readFileSync(`${BUILD}/contracts_SBSDraftPassBBB4V2_sol_SBSDraftPassBBB4V2.abi`, 'utf8'));
const bytecode = `0x${readFileSync(`${BUILD}/contracts_SBSDraftPassBBB4V2_sol_SBSDraftPassBBB4V2.bin`, 'utf8').trim()}`;

const account = privateKeyToAccount(await loadKey());
const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });
const client = createPublicClient({ chain: base, transport: http(RPC) });

const fees = { maxFeePerGas: parseGwei('0.15'), maxPriorityFeePerGas: parseGwei('0.001') };

async function send(label, fn) {
  const hash = await fn();
  const rcpt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rcpt.status !== 'success') throw new Error(`${label} reverted (${hash})`);
  console.log(`✓ ${label}: ${hash}`);
  return rcpt;
}

console.log(`Deployer (owner): ${account.address}`);
const bal = await client.getBalance({ address: account.address });
console.log(`ETH balance: ${Number(bal) / 1e18}`);
if (bal < 2_000_000_000_000_000n / 10n) console.log('⚠ low ETH — deploy needs ~0.0002');

// 1. Deploy — staging collection name. At PROD launch, redeploy this same
// compiled source with the real collection name instead.
const COLLECTION_NAME = 'BBB4 Staging';
const COLLECTION_SYMBOL = 'SBSBBB4';
const deployHash = await wallet.deployContract({ abi, bytecode, args: [COLLECTION_NAME, COLLECTION_SYMBOL, USDC_BASE], ...fees });
const deployRcpt = await client.waitForTransactionReceipt({ hash: deployHash, timeout: 120_000 });
if (deployRcpt.status !== 'success' || !deployRcpt.contractAddress) throw new Error(`deploy failed (${deployHash})`);
const addr = deployRcpt.contractAddress;
console.log(`\n★ SBSDraftPassBBB4V2 deployed: ${addr}\n`);

const read = (functionName, args = []) => client.readContract({ address: addr, abi, functionName, args });
const write = (functionName, args = []) => wallet.writeContract({ address: addr, abi, functionName, args, ...fees });

// 2. Initialize
await send('setBaseURI', () => write('setBaseURI', [BASE_URI]));
await send('flipMintState', () => write('flipMintState'));

// 3. Verify — the V2 behavior, live on-chain
const RANDO = '0x000000000000000000000000000000000000dEaD';
console.log('\n--- verification ---');
console.log('mintIsActive:', await read('mintIsActive'));
console.log('TOKEN_PRICE_USDC:', (await read('TOKEN_PRICE_USDC')).toString());
console.log('conduit auto-approved (any holder):', await read('isApprovedForAll', [RANDO, OPENSEA_CONDUIT]));
console.log('random operator NOT approved:', !(await read('isApprovedForAll', [RANDO, RANDO])));
await send('kill-switch OFF', () => write('setConduitApprovalEnabled', [false]));
console.log('conduit approval after kill-switch:', await read('isApprovedForAll', [RANDO, OPENSEA_CONDUIT]));
await send('kill-switch back ON', () => write('setConduitApprovalEnabled', [true]));
console.log('conduit approval restored:', await read('isApprovedForAll', [RANDO, OPENSEA_CONDUIT]));

// 4. Smoke mint: reserve token 0 to the owner so OpenSea indexes the collection.
await send('reserveTokens(owner, 1)', () => write('reserveTokens', [account.address, 1n]));
console.log('totalSupply:', (await read('totalSupply')).toString());
console.log('tokenURI(0):', await read('tokenURI', [0n]));

console.log(`\nALL DONE. New contract: ${addr}`);
console.log('Next: tell Claude this address so the frontend swap can be filled in.');
