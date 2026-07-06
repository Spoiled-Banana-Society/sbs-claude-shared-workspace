#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const rpc = env.match(/^NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL="?([^"\n]+)"?$/m)[1];
const client = createPublicClient({ chain: base, transport: http(rpc) });
const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
const abi = [{ name:'ownerOf', type:'function', stateMutability:'view', inputs:[{name:'tokenId',type:'uint256'}], outputs:[{type:'address'}] }];
const label = { '0x0173a84e8cd5d19cb3372814dde4c08b0852e013':'Silkyjohnson16', '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7':'Silkyjohnson' };
for (const t of [1649n,1650n,1651n,1652n,1653n,1654n,1655n,1674n,1675n,1676n]) {
  try {
    const o = await client.readContract({ address: CONTRACT, abi, functionName: 'ownerOf', args: [t] });
    console.log(`token ${t}: ${o}  ${label[o.toLowerCase()] || ''}`);
  } catch(e) { console.log(`token ${t}: ERROR ${e.shortMessage || e.message}`); }
}
