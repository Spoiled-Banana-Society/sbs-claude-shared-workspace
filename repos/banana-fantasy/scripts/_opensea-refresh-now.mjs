import { readFileSync } from 'fs';
const KEY=(readFileSync('.env.local','utf8').match(/^OPENSEA_API_KEY=(.*)$/m)||[])[1]?.replace(/['"]/g,'').trim();
const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!KEY){console.log('no key');process.exit(1);}
const ids=[]; for(let i=0;i<=1453;i++) ids.push(i);  // 0-indexed real range
console.log(`refreshing ${ids.length} tokens on OpenSea (0..1453)...`);
let ok=0,fail=0;
for(let i=0;i<ids.length;i+=3){
  const batch=ids.slice(i,i+4);
  const r=await Promise.all(batch.map(async id=>{try{const x=await fetch(`https://api.opensea.io/api/v2/chain/base/contract/${C}/nfts/${id}/refresh`,{method:'POST',headers:{accept:'application/json','x-api-key':KEY}});return x.ok;}catch{return false;}}));
  ok+=r.filter(Boolean).length; fail+=r.filter(x=>!x).length;
  await sleep(700);
  if((i+4)%200===0)process.stdout.write(`  ${i+4}/${ids.length} (ok=${ok} fail=${fail})\n`);
}
console.log(`\ndone: ok=${ok} fail=${fail}. OpenSea re-indexes async over the next several minutes.`);
process.exit(0);
