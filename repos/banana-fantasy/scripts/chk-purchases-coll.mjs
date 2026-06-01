import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();
const WALLETS = {
  'Boris ADMIN': '0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
  'Richard': '0x2e64db49fc597a731091471607f6cd0251d7eafb',
};
for (const [label, w] of Object.entries(WALLETS)) {
  const wallet = w.toLowerCase();
  const snap = await db.collection('v2_purchases').where('userId','==',wallet).limit(2000).get();
  console.log(`\n${label}: v2_purchases docs = ${snap.size}`);
  const byStatus = {};
  for (const d of snap.docs) {
    const p = d.data();
    byStatus[p.status ?? '?'] = (byStatus[p.status ?? '?'] ?? 0) + 1;
  }
  console.log('  by status:', JSON.stringify(byStatus));
  for (const d of snap.docs.slice(0,15)) {
    const p = d.data();
    const c = p.createdAt; const t = typeof c==='string'?c:(c?._seconds?new Date(c._seconds*1000).toISOString():'?');
    console.log(`   ${t} qty=${p.quantity} pay=${p.paymentMethod} status=${p.status} tx=${(p.txHash??'').slice(0,12)}`);
  }
  // failed_mints
  const fm = await db.collection('failed_mints').where('userId','==',wallet).limit(500).get().catch(()=>({size:0,docs:[]}));
  console.log(`  failed_mints = ${fm.size}`);
  for (const d of fm.docs.slice(0,10)) { const f=d.data(); console.log(`    reason=${f.reason||f.source} qty=${f.quantity} tx=${(f.txHash??'').slice(0,12)}`); }
}
process.exit(0);
