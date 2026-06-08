import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const owners = await fs.collection('owners').listDocuments();
console.log(`scanning ${owners.length} owners (read-only)...`);
const availSet = new Set();
let scanned=0;
for (const o of owners) {
  try {
    const d = await (await fetch(`${API}/owner/${o.id.toLowerCase()}/draftToken/all`, { signal: AbortSignal.timeout(8000) })).json();
    for (const t of (d.available||[])) { const r=String(t.realTokenId??''); if(/^\d+$/.test(r)) availSet.add(r); }
  } catch {}
  if(++scanned % 50 === 0) process.stdout.write(`  ${scanned}/${owners.length}\r`);
}
console.log(`\navailable(pass) on-chain ids across all owners: ${availSet.size}`);
const teamSnap = await fs.collection('marketplace_index').where('status','==','team').get();
let ghosts={jp:[],hof:[],pro:0}, genuineJp=[], genuineHof=[];
teamSnap.forEach(d=>{const x=d.data(); const g=availSet.has(x.tokenId);
  if(x.level==='jackpot'){ if(g)ghosts.jp.push(x.tokenId); else genuineJp.push(x.tokenId); }
  else if(x.level==='hof'){ if(g)ghosts.hof.push(x.tokenId); else genuineHof.push(x.tokenId); }
  else if(g)ghosts.pro++;
});
const totGhost=ghosts.jp.length+ghosts.hof.length+ghosts.pro;
console.log(`\nstatus=team total=${teamSnap.size}`);
console.log(`GHOSTS to heal (team→pass): ${totGhost}  [JP ${ghosts.jp.length}, HOF ${ghosts.hof.length}, Pro ${ghosts.pro}]`);
console.log(`  ghost JP: ${ghosts.jp.join(',')||'none'}`);
console.log(`  ghost HOF: ${ghosts.hof.join(',')||'none'}`);
console.log(`GENUINE remaining after heal: JP=${genuineJp.length} (${genuineJp.join(',')||'none'})  HOF=${genuineHof.length} (${genuineHof.join(',')})`);
process.exit(0);
