// Gross USDC received by the live BBB4 contract since deploy (6/22), by day,
// plus current contract balance (un-skimmed) and total skimmed out.
import { createPublicClient, http, parseAbiItem, defineChain, erc20Abi } from 'viem';

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
const start = await blockAt(Date.parse('2026-06-21T00:00:00Z') / 1000);
const evt = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

async function scan(args) {
  const out = [];
  const STEP = 9000n;
  for (let f = start; f <= latest.number; f += STEP) {
    const t = f + STEP - 1n < latest.number ? f + STEP - 1n : latest.number;
    out.push(...await client.getLogs({ address: USDC, event: evt, args, fromBlock: f, toBlock: t }));
  }
  return out;
}

const inLogs = await scan({ to: CONTRACT });
const outLogs = await scan({ from: CONTRACT });

const blockTs = new Map();
async function tsOf(bn) {
  if (!blockTs.has(bn)) blockTs.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp));
  return blockTs.get(bn);
}

const byDay = new Map();
let totalIn = 0n;
for (const l of inLogs) {
  totalIn += l.args.value;
  const d = new Date(await tsOf(l.blockNumber) * 1000).toISOString().slice(0, 10);
  byDay.set(d, (byDay.get(d) ?? 0n) + l.args.value);
}
let totalOut = 0n;
for (const l of outLogs) totalOut += l.args.value;

const bal = await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACT] });

const usd = v => '$' + (Number(v) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
console.log('USDC received by contract, by day:');
for (const d of [...byDay.keys()].sort()) console.log(`  ${d}  ${usd(byDay.get(d))}`);
console.log(`\nTOTAL IN (gross):  ${usd(totalIn)}  across ${inLogs.length} payments`);
console.log(`TOTAL OUT (skims): ${usd(totalOut)}`);
console.log(`CONTRACT BALANCE (un-skimmed): ${usd(bal)}`);
