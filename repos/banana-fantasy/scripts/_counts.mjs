import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const wallets={
 'Boris admin (0x438b)':'0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
 'Boris old (0xd330)':'0xd3301bC039faF4223dA98bcEB5Fb81aBC9399362',
 'Richard (0x2e64)':'0x2e64Db49fc597a731091471607F6CD0251d7EAFb',
};
let totPass=0, totTeam=0;
for(const [name,w] of Object.entries(wallets)){
  const d=await(await fetch(`${API}/owner/${w.toLowerCase()}/draftToken/all`)).json();
  const av=(d.available||[]).length, ac=(d.active||[]).length;
  totPass+=av; totTeam+=ac;
  console.log(`${name}: passes(available)=${av}  teams(active)=${ac}`);
}
console.log(`\nSUM across these wallets: passes=${totPass}  teams=${totTeam}`);
// Index-wide drafted teams (all wallets, current era)
const t=await fs.collection('marketplace_index').where('status','==','team').get();
const p=await fs.collection('marketplace_index').where('status','==','pass').get();
console.log(`\nmarketplace_index (all wallets, current-state): drafted teams=${t.size}  passes-seen=${p.size}`);
process.exit(0);
