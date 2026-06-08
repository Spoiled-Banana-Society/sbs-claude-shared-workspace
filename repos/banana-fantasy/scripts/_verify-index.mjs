import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});
const fs=admin.firestore();
const snap=await fs.collection('marketplace_index').get();
let total=0,team=0,pass=0,jp=0,hof=0,pro=0,nonCanon=[],aboveMax=[];
const maxId=1504;
snap.forEach(d=>{total++;const id=d.id;const x=d.data();
  if(String(Number(id))!==id) nonCanon.push(id);
  if(Number(id)>maxId) aboveMax.push(id);
  if(x.status==='team'){team++; const l=x.level; if(l==='jackpot')jp++;else if(l==='hof')hof++;else pro++;}
  else pass++;
});
console.log('index total docs=',total,' team=',team,' pass=',pass);
console.log('team levels: jackpot=',jp,' hof=',hof,' pro=',pro);
console.log('NON-CANONICAL doc ids=',nonCanon.length, nonCanon.slice(0,20).join(','));
console.log('ABOVE maxId('+maxId+') docs=',aboveMax.length, aboveMax.slice(0,20).join(','));
process.exit(0);
