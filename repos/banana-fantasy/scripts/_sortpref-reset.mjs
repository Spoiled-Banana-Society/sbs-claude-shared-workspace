import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const db=admin.firestore();
const WRITE=process.argv.includes('--write');
// Only the two docs flipped TODAY by the reverted auto-flip bug.
const ids=['0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae','0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11'];
for(const id of ids){
  const ref=db.collection('userSortPreference').doc(id);
  const s=await ref.get();
  console.log(id, 'current:', s.exists?s.data().preference:'(none)', WRITE?'-> DELETE (default adp)':'(dry-run)');
  if(WRITE) await ref.delete();
}
console.log(WRITE?'DONE':'dry-run only; pass --write');
process.exit(0);
