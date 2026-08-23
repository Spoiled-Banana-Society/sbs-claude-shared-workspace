#!/usr/bin/env node
// READ-ONLY: for every unused PAID pass, find the purchase event that minted it + any promo rewards around it.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const valid = await db.collectionGroup('validDraftTokens').get();
const paid = [];
for (const d of valid.docs) { const x = d.data(); if (String(x.PassType ?? '').toLowerCase() === 'paid') paid.push({ id: d.id, wallet: d.ref.parent.parent.id.toLowerCase() }); }
console.log('unused paid tokens:', paid.length);

const ev = await db.collection('v2_activity_events').where('type', 'in', ['pass_purchased', 'pass_granted', 'promo_claimed']).get();
console.log('events:', ev.size);
const byToken = new Map(); const byUser = {};
for (const d of ev.docs) {
  const e = d.data(); const uid = String(e.userId || e.walletAddress || '').toLowerCase();
  (byUser[uid] ||= []).push(e);
  for (const t of (e.tokenIds || [])) byToken.set(String(t), e);
}
const names = {};
async function nameOf(w) { if (names[w]) return names[w]; const u = await db.collection('v2_users').doc(w).get(); return names[w] = (u.exists ? (u.data().username || '(no name)') : '(no doc)'); }

const rows = [];
for (const p of paid) {
  const e = byToken.get(String(p.id));
  const name = await nameOf(p.wallet);
  if (!e) { rows.push({ token: p.id, wallet: p.wallet, name, evType: 'NONE' }); continue; }
  const m = e.metadata || {};
  const t0 = Date.parse(e.createdAtIso);
  const near = (byUser[String(e.userId||'').toLowerCase()] || []).filter(x => x !== e && Math.abs(Date.parse(x.createdAtIso) - t0) < 7*86400e3)
    .map(x => `${x.type}${x.metadata?.promoType ? ':' + x.metadata.promoType : ''}${x.metadata?.source ? ':' + x.metadata.source : ''}${x.metadata?.prizeType ? ':' + x.metadata.prizeType : ''} q${x.quantity ?? ''} ${x.createdAtIso?.slice(0,10)}`);
  rows.push({ token: p.id, wallet: p.wallet, name, evType: e.type, date: e.createdAtIso?.slice(0,16), qty: e.quantity, totalPrice: m.totalPrice, pay: e.paymentMethod, source: m.source, promo: m.promoType, tx: e.txHash, near: near.join(' | ') });
}
rows.sort((a, b) => (a.name + a.date).localeCompare(b.name + b.date));
const hdr = ['token','name','wallet','evType','date','qty','totalPrice','pay','source','promo','tx','near'];
writeFileSync(process.env.HOME + '/Downloads/_paid-pass-origins-raw.csv', [hdr.join(','), ...rows.map(r => hdr.map(h => `"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n'));
for (const r of rows) console.log([r.name, r.token, r.evType, r.date, `q${r.qty}`, `$${r.totalPrice}`, r.pay, r.source || '', r.promo || '', '::', r.near].join(' '));
process.exit(0);
