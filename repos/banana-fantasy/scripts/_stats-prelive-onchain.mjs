// On-chain mints on the LIVE BBB4 contract (0xadf5b9b4…) before go-live
// (2026-06-22 4:20 PM Pacific = 2026-06-22T23:20:00Z). Classifies each mint tx
// as paid (public mint, USDC moved) vs owner/reserve (no USDC from minter).
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem';

const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CUTOFF = Date.parse('2026-06-22T23:20:00Z') / 1000;
const RPC = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';

const base = defineChain({
  id: 8453, name: 'Base', network: 'base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
});
const client = createPublicClient({ chain: base, transport: http(RPC) });

const latest = await client.getBlock();
// Base = 2s blocks. Find block at cutoff by binary search on timestamp.
async function blockAt(ts) {
  let lo = 1n, hi = latest.number;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n; else hi = mid;
  }
  return lo;
}
const cutoffBlock = await blockAt(CUTOFF);
// contract deployed 6/22 — start search a day earlier to be safe
const startBlock = await blockAt(CUTOFF - 36 * 3600);
console.log(`blocks ${startBlock} → ${cutoffBlock} (cutoff ${new Date(CUTOFF * 1000).toISOString()})`);

const transferEvt = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 tokenId)');
const logs = [];
const STEP = 5000n;
for (let from = startBlock; from < cutoffBlock; from += STEP) {
  const to = from + STEP - 1n < cutoffBlock - 1n ? from + STEP - 1n : cutoffBlock - 1n;
  const chunk = await client.getLogs({
    address: CONTRACT, event: transferEvt,
    args: { from: '0x0000000000000000000000000000000000000000' },
    fromBlock: from, toBlock: to,
  });
  logs.push(...chunk);
}
console.log(`mint Transfer logs before cutoff: ${logs.length}`);

// group by tx, classify via USDC transfer in same tx
const usdcEvt = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const byTx = new Map();
for (const l of logs) {
  if (!byTx.has(l.transactionHash)) byTx.set(l.transactionHash, []);
  byTx.get(l.transactionHash).push(l);
}
let paidQty = 0, freeQty = 0;
for (const [txh, ls] of byTx) {
  const rcpt = await client.getTransactionReceipt({ hash: txh });
  const blk = await client.getBlock({ blockNumber: rcpt.blockNumber });
  const usdcMoved = rcpt.logs.some(l => l.address.toLowerCase() === USDC.toLowerCase());
  const tx = await client.getTransaction({ hash: txh });
  const tokenIds = ls.map(l => Number(l.args.tokenId));
  const minter = ls[0].args.to;
  const kind = usdcMoved ? 'PAID($25ea in-tx)' : 'no-USDC-in-tx';
  if (usdcMoved) paidQty += ls.length; else freeQty += ls.length;
  console.log(`${new Date(Number(blk.timestamp) * 1000).toISOString().slice(0, 19)}  to=${minter.slice(0, 12)}  from=${tx.from.slice(0, 12)}  tokens=[${tokenIds.join(',')}]  qty=${ls.length}  ${kind}`);
}
console.log(`\nTOTAL minted before cutoff: ${logs.length} passes`);
console.log(`  with USDC in same tx: ${paidQty} ($${paidQty * 25})`);
console.log(`  without USDC in tx (2-tx pay flow or owner mint): ${freeQty} ($${freeQty * 25} if paid)`);
