// Full mint timeline for the live BBB4 contract, first N days, so we can see
// exactly when go-live traffic starts and what came before it.
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem';
const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
const RPC = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';
const base = defineChain({ id: 8453, name: 'Base', network: 'base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } } });
const client = createPublicClient({ chain: base, transport: http(RPC) });
const latest = await client.getBlock();
async function blockAt(ts) {
  let lo = 1n, hi = latest.number;
  while (lo < hi) { const mid = (lo + hi) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n; else hi = mid; }
  return lo;
}
const start = await blockAt(Date.parse('2026-06-22T00:00:00Z') / 1000);
const end = await blockAt(Date.parse('2026-06-25T00:00:00Z') / 1000);
const evt = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 tokenId)');
const logs = [];
for (let f = start; f < end; f += 5000n) {
  const t = f + 4999n < end ? f + 4999n : end;
  logs.push(...await client.getLogs({ address: CONTRACT, event: evt,
    args: { from: '0x0000000000000000000000000000000000000000' }, fromBlock: f, toBlock: t }));
}
console.log(`mints 6/22 00:00Z – 6/25 00:00Z: ${logs.length}`);
const byTx = new Map();
for (const l of logs) { (byTx.get(l.transactionHash) ?? byTx.set(l.transactionHash, []).get(l.transactionHash)).push(l); }
const blockCache = new Map();
for (const [txh, ls] of byTx) {
  const bn = ls[0].blockNumber;
  if (!blockCache.has(bn)) blockCache.set(bn, await client.getBlock({ blockNumber: bn }));
  const b = blockCache.get(bn);
  const ids = ls.map(l => Number(l.args.tokenId));
  console.log(`${new Date(Number(b.timestamp) * 1000).toISOString().slice(0, 19)}Z  to=${ls[0].args.to.slice(0, 12)}  qty=${ls.length}  tokens=${ids[0]}..${ids[ids.length - 1]}  tx=${txh.slice(0, 14)}`);
}
