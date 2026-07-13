import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const HOME = process.env.HOME;
const saJson = JSON.parse(fs.readFileSync(HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

// bot registry check
const bots = await db.collection('botWallets').get();
const botSet = new Set(bots.docs.map(d => (d.get('wallet') ?? d.id).toLowerCase()));
console.log('botWallets registry:', bots.size);

// classification from the last run
const rows = fs.readFileSync(HOME + '/Downloads/sbs_new_vs_returning_2026-07-12.csv', 'utf-8').trim().split('\n').slice(1)
  .map(l => {
    const m = l.match(/^([^,]+),"([^"]*)","([^"]*)",([^,]*),([^,]+),(\d+),(\d+),(\d+)$/);
    return m && { wallet: m[1], username: m[2], email: m[3], created: m[4], status: m[5], payments: +m[6], usd: +m[8] };
  }).filter(Boolean);
console.log('csv rows:', rows.length);

// free passes minted per wallet (pass_origin.ownerAtMint)
const freeByWallet = new Map();
const po = await db.collection('pass_origin').select('ownerAtMint', 'origin').get();
for (const d of po.docs) {
  const w = (d.get('ownerAtMint') ?? '').toLowerCase();
  const rec = freeByWallet.get(w) ?? { spin: 0, grant: 0 };
  if (d.get('origin') === 'spin_reward') rec.spin++; else rec.grant++;
  freeByWallet.set(w, rec);
}

// teams currently owned (draftTokens.OwnerId) — drafted vs blank
const teamsByWallet = new Map();
let last = null;
while (true) {
  let q = db.collection('draftTokens').orderBy('__name__').select('OwnerId', 'LeagueId').limit(1000);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (!snap.size) break;
  for (const d of snap.docs) {
    const w = (d.get('OwnerId') ?? '').toLowerCase();
    const rec = teamsByWallet.get(w) ?? { drafted: 0, blank: 0 };
    if (d.get('LeagueId')) rec.drafted++; else rec.blank++;
    teamsByWallet.set(w, rec);
  }
  last = snap.docs[snap.size - 1];
}

// how many bots have v2_users docs?
const csvWallets = new Set(rows.map(r => r.wallet));
const botsInUsers = [...botSet].filter(w => csvWallets.has(w));
console.log('bot wallets that have user docs:', botsInUsers.length);

function breakdown(label, arr) {
  const buckets = { bought: [], freeActive: [], ghost: [] };
  for (const r of arr) {
    const free = freeByWallet.get(r.wallet);
    const teams = teamsByWallet.get(r.wallet);
    if (r.usd > 0) buckets.bought.push(r);
    else if ((free && (free.spin + free.grant) > 0) || (teams && (teams.drafted + teams.blank) > 0)) buckets.freeActive.push(r);
    else buckets.ghost.push(r);
  }
  console.log(`\n${label} (${arr.length}):`);
  console.log(`  bought:              ${buckets.bought.length}`);
  console.log(`  free passes/teams:   ${buckets.freeActive.length}  (spun the wheel / got a pass / drafted, never paid)`);
  console.log(`  ghosts (signed up, nothing else): ${buckets.ghost.length}`);
  return buckets;
}

const newUsers = rows.filter(r => r.status === 'new');
const returning = rows.filter(r => r.status === 'returning');
const nb = breakdown('NEW USERS', newUsers);
const rb = breakdown('RETURNING', returning);

console.log('\nReturning non-buyers with free activity:');
for (const r of rb.freeActive) {
  const f = freeByWallet.get(r.wallet) ?? { spin: 0, grant: 0 };
  const t = teamsByWallet.get(r.wallet) ?? { drafted: 0, blank: 0 };
  console.log(`  ${(r.username || r.wallet.slice(0, 10)).padEnd(22)} freePasses: ${f.spin} spin + ${f.grant} granted, teams drafted: ${t.drafted}`);
}
console.log('\nReturning ghosts (came back, logged in, nothing else):');
for (const r of rb.ghost) console.log(`  ${r.username || r.wallet.slice(0, 10)}`);

// new-user free-active sample + ghost email/signup profile
console.log('\nNew free-active (top 15 by teams):');
const nfa = nb.freeActive.map(r => ({ r, t: teamsByWallet.get(r.wallet) ?? { drafted: 0 }, f: freeByWallet.get(r.wallet) ?? { spin: 0, grant: 0 } }))
  .sort((a, b) => b.t.drafted - a.t.drafted);
for (const { r, t, f } of nfa.slice(0, 15)) {
  console.log(`  ${(r.username || r.wallet.slice(0, 10)).padEnd(22)} teams: ${t.drafted}, free: ${f.spin} spin + ${f.grant} granted`);
}
const ghostEmails = nb.ghost.filter(r => r.email).length;
console.log(`\nNew ghosts: ${nb.ghost.length} total, ${ghostEmails} have emails`);
const byMonth = {};
for (const r of nb.ghost) byMonth[r.created.slice(0, 7) || '?'] = (byMonth[r.created.slice(0, 7) || '?'] ?? 0) + 1;
console.log('new-ghost signups by month:', JSON.stringify(byMonth));

// split new free-active: real wheel users (spun) vs grant-only (likely comps/test)
let spinUsers = 0, grantOnly = 0;
for (const r of nb.freeActive) {
  const f = freeByWallet.get(r.wallet) ?? { spin: 0, grant: 0 };
  if (f.spin > 0) spinUsers++; else grantOnly++;
}
console.log(`\nNew free-active split: ${spinUsers} won passes on the wheel themselves, ${grantOnly} only have admin-granted passes or blank/drafted teams`);

// FINAL FILTERED VIEW: drop ghosts + grant-only accounts (keep buyers + self-spinners)
console.log('\n================ ENGAGED-ONLY NUMBERS ================');
let csv = 'wallet,username,email,created,status,engagement,payments,passes_bought,usd\n';
for (const [label, buckets] of [['NEW', nb], ['RETURNING', rb]]) {
  const spinners = buckets.freeActive.filter(r => (freeByWallet.get(r.wallet) ?? { spin: 0 }).spin > 0);
  const buyers = buckets.bought;
  const usd = buyers.reduce((s, r) => s + r.usd, 0);
  console.log(`${label}: ${buyers.length + spinners.length} engaged users = ${buyers.length} buyers ($${usd}) + ${spinners.length} wheel-only (never paid)`);
  console.log(`   dropped: ${buckets.ghost.length} ghosts + ${buckets.freeActive.length - spinners.length} grant-only accounts`);
  for (const r of buyers) csv += `${r.wallet},"${r.username}","${r.email}",${r.created},${label.toLowerCase()},buyer,${r.payments},${Math.round(r.usd / 25)},${r.usd}\n`;
  for (const r of spinners) csv += `${r.wallet},"${r.username}","${r.email}",${r.created},${label.toLowerCase()},wheel-only,0,0,0\n`;
}
fs.writeFileSync(HOME + '/Downloads/sbs_engaged_users_2026-07-12.csv', csv);
console.log('CSV saved: ~/Downloads/sbs_engaged_users_2026-07-12.csv');
