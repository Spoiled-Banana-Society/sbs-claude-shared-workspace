#!/usr/bin/env node
// Retag UNUSED passes that are free-origin (wheel win) but were registered 'paid' on the
// recipient after a wallet-to-wallet transfer (reconciler bug, fixed in code 8/19 by Boris).
// Dry-run by default. APPLY=1 to write. Touches: owners/{w}/validDraftTokens/{cardId}.PassType,
// draftTokens/{cardId}.PassType, then re-mirrors v2_users.draftPasses/freeDrafts from inventory.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) }); const db = getFirestore();
const APPLY = process.env.APPLY === '1';
console.log(APPLY ? '*** APPLY MODE ***' : '--- dry run ---');

const po = new Map((await db.collection('pass_origin').get()).docs.map(d => [d.id, d.data()]));
const valid = await db.collectionGroup('validDraftTokens').get();
const targets = [];
for (const d of valid.docs) {
  const x = d.data(); if (String(x.PassType).toLowerCase() !== 'paid') continue;
  const real = String(x.RealTokenId || d.id); const o = po.get(real); if (!o) continue;
  const w = d.ref.parent.parent.id.toLowerCase();
  if (o.origin !== 'spin_reward') continue;                 // only wheel wins (admin grants left alone, flagged separately)
  if (o.ownerAtMint.toLowerCase() === w) continue;          // only TRANSFERRED ones
  targets.push({ w, cardId: d.id, real, ref: d.ref, level: x.Level });
}
console.log('targets:', targets.length);
const wallets = new Set();
for (const t of targets) {
  wallets.add(t.w);
  const g = await db.collection('draftTokens').doc(t.cardId).get();
  const m = await db.collection('draftTokenMetadata').doc(t.cardId).get();
  const mAttrs = m.exists ? JSON.stringify(m.data()).match(/pass ?type[^,}]*/i)?.[0] : null;
  console.log(`${t.w.slice(0,10)} card ${t.cardId} real ${t.real} level=${t.level} | draftTokens: ${g.exists ? g.data().PassType + '/' + g.data().OwnerId?.slice(0,10) : 'none'} | metadata passType attr: ${mAttrs ?? 'none'}`);
  if (APPLY) {
    await t.ref.update({ PassType: 'free' });
    if (g.exists && String(g.data().OwnerId).toLowerCase() === t.w) await g.ref.update({ PassType: 'free' });
  }
}
// re-mirror counters (same rules as lib/passLedger countSpendableTokens)
for (const w of wallets) {
  const s = await db.collection(`owners/${w}/validDraftTokens`).get();
  let paid = 0, free = 0;
  s.forEach(doc => { const x = doc.data(); const lvl = String(x.Level ?? '').trim(); if (['Hall of Fame','Jackpot','JackHOF'].includes(lvl)) return; (String(x.PassType ?? '').toLowerCase() === 'free' ? free++ : paid++); });
  const u = (await db.collection('v2_users').doc(w).get()).data() || {};
  console.log(`${u.username} ${w.slice(0,10)}: draftPasses ${u.draftPasses} -> ${paid}, freeDrafts ${u.freeDrafts} -> ${free}`);
  if (APPLY) await db.collection('v2_users').doc(w).set({ draftPasses: paid, freeDrafts: free, passesSyncedAt: FieldValue.serverTimestamp() }, { merge: true });
}
process.exit(0);
