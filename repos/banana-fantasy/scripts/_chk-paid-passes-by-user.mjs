#!/usr/bin/env node
// READ-ONLY: who currently holds UNUSED paid draft passes (validDraftTokens PassType=paid), grouped by wallet.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collectionGroup('validDraftTokens').get();
console.log('total valid (unused) pass docs:', snap.size);
const byWallet = {}; const passTypes = {};
for (const d of snap.docs) {
  const data = d.data();
  const pt = String(data.PassType ?? data.passType ?? '').toLowerCase();
  passTypes[pt] = (passTypes[pt] || 0) + 1;
  const wallet = d.ref.parent.parent.id.toLowerCase();
  if (!byWallet[wallet]) byWallet[wallet] = { paid: [], free: [], other: [] };
  const level = data.Level ?? data.level ?? '';
  const row = { id: d.id, level };
  if (pt === 'paid') byWallet[wallet].paid.push(row);
  else if (pt === 'free') byWallet[wallet].free.push(row);
  else byWallet[wallet].other.push({ ...row, pt });
}
console.log('by PassType:', JSON.stringify(passTypes));

const bots = new Set((await db.collection('botWallets').get()).docs.map(d => d.id.toLowerCase()));
const rows = [];
for (const [w, v] of Object.entries(byWallet)) {
  if (!v.paid.length) continue;
  const u = await db.collection('v2_users').doc(w).get();
  const ud = u.exists ? u.data() : {};
  rows.push({
    wallet: w, bot: bots.has(w), name: ud.username || ud.name || (u.exists ? "(no name)" : "(no user doc)"),
    paid: v.paid.length, free: v.free.length,
    paidLevels: Object.entries(v.paid.reduce((a, r) => (a[r.level || 'Pro'] = (a[r.level || 'Pro'] || 0) + 1, a), {})).map(([k, n]) => `${k}:${n}`).join(' '),
    paidIds: v.paid.map(r => r.id).sort((a, b) => a - b).join(' '),
  });
}
rows.sort((a, b) => b.paid - a.paid);
const humans = rows.filter(r => !r.bot);
console.log(`\nwallets holding unused PAID passes: ${rows.length} (bots: ${rows.length - humans.length})`);
console.log(`total unused paid passes held by humans: ${humans.reduce((s, r) => s + r.paid, 0)}`);
console.log('\nname | paid | levels | free | wallet');
for (const r of rows) console.log(`${r.bot ? '[BOT] ' : ''}${r.name} | ${r.paid} | ${r.paidLevels} | ${r.free} | ${r.wallet}`);
const csv = ['name,wallet,bot,unused_paid,paid_levels,unused_free,paid_token_ids', ...rows.map(r => [r.name, r.wallet, r.bot, r.paid, r.paidLevels, r.free, r.paidIds].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n');
const out = process.env.HOME + '/Downloads/unused-paid-passes-by-user-2026-08-22.csv';
writeFileSync(out, csv); console.log('\nCSV:', out);
process.exit(0);
