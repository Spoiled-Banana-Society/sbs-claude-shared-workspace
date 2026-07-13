import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

// 1. Inspect current gate state
const userRef = fs.collection('v2_users').doc(w);
const snap = await userRef.get();
console.log('v2_users exists:', snap.exists);
console.log('  returningCheckedAt:', snap.get('returningCheckedAt') ?? '(none)');
console.log('  isReturningPlayer:', snap.get('isReturningPlayer') ?? '(none)');
console.log('  firstLoginAt:', snap.get('firstLoginAt') ?? '(none)');

// 2. Check dedupe doc
const notiId = `${w}__base-usdc-guide`;
const noti = await fs.collection('marketplace_notifications').doc(notiId).get();
console.log('existing base-guide noti doc:', noti.exists);

// 3. Clear the gates: returningCheckedAt (route early-return) + isReturningPlayer
//    (other early-return) + the dedupe doc if present. Do NOT touch anything else.
await userRef.update({
  returningCheckedAt: admin.firestore.FieldValue.delete(),
  isReturningPlayer: admin.firestore.FieldValue.delete(),
  returningVia: admin.firestore.FieldValue.delete(),
  returningOldWallet: admin.firestore.FieldValue.delete(),
});
if (noti.exists) await fs.collection('marketplace_notifications').doc(notiId).delete();
console.log('\n✓ Gate cleared — next login fires the returning-check fresh and creates the Base noti (wallet login).');
process.exit(0);
