#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const rpc = env.match(/^NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL="?([^"\n]+)"?$/m)[1];
const m = rpc.match(/^(https?:\/\/[^/]+)\/v2\/([^/?#]+)/);
const base = `${m[1]}/nft/v3/${m[2]}`;
const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
for (const [name,w] of [['Silkyjohnson16','0x0173a84e8cd5d19cb3372814dde4c08b0852e013'],['Silkyjohnson','0x8d1ae27f10654d8f2604feae84485b84a7ad0da7']]) {
  const u = `${base}/getNFTsForOwner?owner=${w}&withMetadata=false&contractAddresses[]=${CONTRACT}`;
  const r = await fetch(u).then(r=>r.json());
  console.log(name, 'alchemy tokens:', (r.ownedNfts||[]).map(n=>parseInt(n.tokenId,16)||n.tokenId).join(', '), '| totalCount:', r.totalCount);
}
