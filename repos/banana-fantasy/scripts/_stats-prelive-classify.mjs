// Classify every live-contract mint before go-live (2026-06-23T23:20:00Z = 4:20pm PDT 6/23):
// paid (USDC moved in the mint tx) vs owner/reserve mint, with real token IDs and tx senders.
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem';
const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
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
const CUTOFF = Date.parse('2026-06-23T23:20:00Z') / 1000;
const start = await blockAt(Date.parse('2026-06-22T00:00:00Z') / 1000);
const end = await blockAt(CUTOFF);
const evt = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const logs = [];
for (let f = start; f < end; f += 5000n) {
  const t = f + 4999n < end - 1n ? f + 4999n : end - 1n;
  logs.push(...await client.getLogs({ address: CONTRACT, event: evt,
    args: { from: '0x0000000000000000000000000000000000000000' }, fromBlock: f, toBlock: t }));
}
const byTx = new Map();
for (const l of logs) { if (!byTx.has(l.transactionHash)) byTx.set(l.transactionHash, []); byTx.get(l.transactionHash).push(l); }
let paid = 0, owner = 0, other = 0;
const rows = [];
for (const [txh, ls] of byTx) {
  const rcpt = await client.getTransactionReceipt({ hash: txh });
  const blk = await client.getBlock({ blockNumber: rcpt.blockNumber });
  const tx = await client.getTransaction({ hash: txh });
  const usdcMoved = rcpt.logs.some(l => l.address.toLowerCase() === USDC.toLowerCase());
  const ids = ls.map(l => Number(l.args.tokenId)).sort((a, b) => a - b);
  const sender = tx.from.toLowerCase();
  const isOwnerSender = sender === '0xccdf79a51d292cf6de8807abc1bb58d07d26441d'.toLowerCase() || sender.startsWith('0x91889e');
  let kind;
  if (usdcMoved) { kind = 'PAID'; paid += ls.length; }
  else if (isOwnerSender) { kind = 'OWNER-MINT'; owner += ls.length; }
  else { kind = 'NO-USDC(2tx-pay?)'; other += ls.length; }
  rows.push({ ts: Number(blk.timestamp), line: `${new Date(Number(blk.timestamp) * 1000).toISOString().slice(0, 19)}Z  to=${ls[0].args.to.slice(0, 12)}  sender=${tx.from.slice(0, 12)}  qty=${ls.length}  tokens=${ids.join(',')}  ${kind}` });
}
rows.sort((a, b) => a.ts - b.ts);
for (const r of rows) console.log(r.line);
console.log(`\nBEFORE 4:20pm PDT 6/23 — total minted: ${logs.length}`);
console.log(`  PAID (usdc in tx): ${paid}  = $${paid * 25}`);
console.log(`  OWNER mints: ${owner}  = $${owner * 25} face value`);
console.log(`  no-USDC other senders: ${other}  = $${other * 25} face value`);
