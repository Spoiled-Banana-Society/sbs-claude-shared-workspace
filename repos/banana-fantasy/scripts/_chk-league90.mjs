import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa),databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com'});
const fs=admin.firestore();
const id='2026-slow-draft-4';
const doc=await fs.collection('drafts').doc(id).get();
const d=doc.data();
console.log('=== draft doc (select fields) ===');
for(const k of Object.keys(d).sort()){const v=d[k];const s=JSON.stringify(v);console.log(k,'=',s&&s.length>200?s.slice(0,200)+'…':s);}
console.log('\n=== users ===');
const seats=['0xfef1083144572c5a9bd9e057218abc324f55491b','0xdad494e65f38f2111e2c333cfef0c0883a88bee7','0xbfb4427e43072c5611f450ae5d6182b18e1d7485','0x9f9edc2fdaf512c38d181538c68142a743d72255','0x3a0491e718988c77394c12ef639c9bc424c536da','0x466d16ec1724f08aaeec2399816160f0d95d9d4f','0xb6427f566ff91287e01d583af084670420dc1103','0xdf8d910ca8caf9d3c7dea9b62d36400b38003c61','0x9b62e42cc014e379b85cb805a0a5a0c0b18f0650','0x4cb8a72d3456ff8124285869270af99598371b7c'];
for(let i=0;i<seats.length;i++){const w=seats[i];
  const u=await fs.collection('v2_users').doc(w).get();
  const n=u.exists?(u.data().username||u.data().displayName||u.data().name):null;
  console.log(`seat ${i+1}: ${w.slice(0,10)} -> ${n}`);}
console.log('\n=== RTDB realTimeDraftInfo ===');
const rt=await admin.database().ref(`drafts/${id}/realTimeDraftInfo`).get();
console.log(JSON.stringify(rt.val(),null,1));
process.exit(0);
