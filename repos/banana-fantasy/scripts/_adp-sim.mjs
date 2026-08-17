import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const db=admin.firestore();
const c=JSON.parse(readFileSync(process.env.IN));
const EXCL=new Set(['2026-slow-draft-40']);
const players=(await db.doc('playerStats2026/playerMap').get()).data().Players;
const pm={};let N=0;for(const x of c){if(EXCL.has(x.id))continue;N++;for(const p of x.picks){(pm[p.pid]||=[]).push(p.pick);}}
const rows=[];
for(const pid of Object.keys(players)){
  const picks=pm[pid]||[];const n=picks.length;const sum=picks.reduce((a,b)=>a+b,0);
  const raw=n?sum/n:null; const shrunk=(sum+(N-n)*151)/N;
  rows.push({pid,cur:players[pid].ADP,n,raw:raw?.toFixed(1),shrunk:Math.round(shrunk)});
}
console.log('N=',N,'players',rows.length);
console.log('never drafted:',rows.filter(r=>r.n===0).length,'sample cur ADP:',rows.filter(r=>r.n===0).map(r=>r.pid+':'+r.cur).slice(0,15).join(' '));
console.log('drafted <20 times:');
for(const r of rows.filter(r=>r.n>0&&r.n<20).sort((a,b)=>a.n-b.n)) console.log(r.pid,'cur',r.cur,'n',r.n,'raw',r.raw,'shrunk',r.shrunk);
console.log('drafted 20-600:');
for(const r of rows.filter(r=>r.n>=20&&r.n<600).sort((a,b)=>a.n-b.n)) console.log(r.pid,'cur',r.cur,'n',r.n,'raw',r.raw,'shrunk',r.shrunk);
console.log('cur ADP range for n>=600:',Math.min(...rows.filter(r=>r.n>=600).map(r=>r.cur)),Math.max(...rows.filter(r=>r.n>=600).map(r=>r.cur)));
process.exit(0);
