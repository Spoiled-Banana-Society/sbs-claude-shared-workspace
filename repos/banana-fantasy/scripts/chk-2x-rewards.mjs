import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

const WALLETS = {
  'Boris ADMIN': '0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
  'Boris old Privy': '0xd3301bc039faf4223da98bceb5fb81abc9399362',
  'Richard': '0x2e64db49fc597a731091471607f6cd0251d7eafb',
};

function tsToStr(ev) {
  const c = ev.createdAt;
  if (!c) return '?';
  if (typeof c === 'string') return c;
  if (c._seconds) return new Date(c._seconds * 1000).toISOString();
  if (c.toDate) return c.toDate().toISOString();
  return String(c);
}

for (const [label, walletRaw] of Object.entries(WALLETS)) {
  const wallet = walletRaw.toLowerCase();
  console.log('\n==================================================');
  console.log(`${label}  ${wallet}`);
  console.log('==================================================');

  // --- user doc ---
  const userSnap = await db.collection('v2_users').doc(wallet).get();
  if (userSnap.exists) {
    const u = userSnap.data();
    console.log('USER DOC:', JSON.stringify({
      draftPasses: u.draftPasses,
      freeDrafts: u.freeDrafts,
      wheelSpins: u.wheelSpins,
      cardPurchaseCount: u.cardPurchaseCount,
      firstPurchaseBonusGranted: u.firstPurchaseBonusGranted,
    }));
  } else {
    console.log('USER DOC: (none)');
  }

  // --- pass_purchased activity events ---
  const ev = await db.collection('v2_activity_events')
    .where('userId', '==', wallet)
    .where('type', '==', 'pass_purchased')
    .limit(5000).get();
  console.log(`\npass_purchased events: ${ev.size}`);
  const rows = ev.docs.map((d) => {
    const e = d.data();
    const m = e.metadata || {};
    return {
      t: tsToStr(e),
      qty: e.quantity,
      pay: e.paymentMethod,
      source: m.source ?? '(none)',
      purchaseId: m.purchaseId ? 'YES' : '-',
      permitTx: m.permitTxHash ? 'YES' : '-',
      txHash: (e.txHash ?? '').slice(0, 12),
      freeAdded: m.freeDraftsAdded,
      spinsAdded: m.spinsAdded,
    };
  }).sort((a, b) => (a.t < b.t ? -1 : 1));
  for (const r of rows) {
    console.log(`  ${r.t} qty=${r.qty} pay=${r.pay} source=${r.source} purchaseId=${r.purchaseId} permitTx=${r.permitTx} tx=${r.txHash} free=${r.freeAdded} spins=${r.spinsAdded}`);
  }

  // Group by txHash to spot double events on one mint tx
  const byTx = {};
  for (const r of rows) {
    if (!r.txHash) continue;
    (byTx[r.txHash] ??= []).push(r);
  }
  const dupes = Object.entries(byTx).filter(([, arr]) => arr.length > 1);
  console.log(`\n  txHashes with >1 pass_purchased event (double-run fingerprint): ${dupes.length}`);
  for (const [tx, arr] of dupes) {
    console.log(`    tx=${tx} -> ${arr.length} events [sources: ${arr.map(a => a.source).join(', ')}]`);
  }
  const totalPassesBought = rows.reduce((s, r) => s + (r.qty || 0), 0);
  console.log(`  sum(quantity) across ALL pass_purchased events = ${totalPassesBought}`);

  // --- promos subcollection ---
  const promos = await db.collection('v2_users').doc(wallet).collection('promos').get();
  console.log(`\n  promos: ${promos.size}`);
  for (const p of promos.docs) {
    const d = p.data();
    console.log(`    [${d.type}] progressCurrent=${d.progressCurrent} progressMax=${d.progressMax} claimCount=${d.claimCount} totalMinted=${d.modalContent?.totalMinted}`);
  }
}

console.log('\nDONE');
process.exit(0);
