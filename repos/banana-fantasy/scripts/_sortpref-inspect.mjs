import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const db=admin.firestore();
const snap=await db.collection('userSortPreference').get();
console.log('total docs:', snap.size);
snap.forEach(d=>{const x=d.data(); const t=x.updatedAt?.toDate?x.updatedAt.toDate().toISOString():(x.updatedAt||'?'); console.log(d.id, '=>', x.preference, '| updated', t);});
process.exit(0);
