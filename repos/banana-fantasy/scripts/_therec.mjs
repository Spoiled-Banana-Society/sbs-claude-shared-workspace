import admin from 'firebase-admin';
import fs from 'fs';
const b64 = fs.readFileSync('lib/firebaseAdmin.ts','utf8').match(/STAGING_SA_B64 = '([^']+)'/)[1];
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(b64,'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db=admin.firestore(); const rtdb=admin.database();

// 1) find Therec's wallet (usernames collection, case-insensitive-ish)
console.log('=== find user "Therec" ===');
const unames=await db.collection('usernames').get();
let therec=[];
unames.forEach(d=>{const x=d.data();const n=String(x.username||x.name||d.id||'');if(n.toLowerCase().includes('therec')) therec.push({doc:d.id, data:JSON.stringify(x).slice(0,150)});});
therec.forEach(t=>console.log('  usernames/'+t.doc, t.data));
// also v2_users
const v2=await db.collection('v2_users').where('username','>=','Therec').where('username','<=','Therec').get().catch(()=>({forEach:()=>{}}));
v2.forEach(d=>console.log('  v2_users/'+d.id, 'username=',d.data().username, 'wallet=',d.data().walletAddress));

// 2) find League 29 draft
console.log('\n=== League 29 draft ===');
const drafts=await db.collection('drafts').get();
for(const d of drafts.docs){
  if(d.id==='draftTracker')continue;
  const info=(await d.ref.collection('state').doc('info').get()).data()||{};
  const num=String(info.DisplayName||'').replace(/\D/g,'');
  if(num==='29'){
    const rt=(await rtdb.ref(`drafts/${d.id}/realTimeDraftInfo`).get()).val()||{};
    const cards=await d.ref.collection('cards').get();
    console.log(`  draft=${d.id} dn="${info.DisplayName}" complete=${rt.isDraftComplete} closed=${rt.isDraftClosed} pick#=${rt.pickNumber} cards=${cards.size}`);
    console.log('  card tokenIds:', cards.docs.map(c=>{const x=c.data();return String(x.CardId??c.id);}).join(','));
  }
}
