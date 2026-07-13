import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const HOME = process.env.HOME;
const saJson = JSON.parse(fs.readFileSync(HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

// ---------- past players (wallets + emails) ----------
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const pastCsv = fs.readFileSync(HOME + '/sbs-past-players/all_time_players.csv', 'utf-8').trim().split('\n');
const pastWallets = new Set(), pastEmails = new Set();
for (const line of pastCsv.slice(1)) {
  const [wallet, , email] = parseCsvLine(line);
  if (wallet) pastWallets.add(wallet.toLowerCase());
  if (email) pastEmails.add(email.toLowerCase().trim());
}
console.log(`past players: ${pastWallets.size} wallets, ${pastEmails.size} emails`);

// BBB3 season sheet from Richard (wallet + Twitter/Discord names) — catches returners on new wallets
const normName = s => String(s ?? '').toLowerCase().replace(/\.eth$/, '').replace(/[^a-z0-9]/g, '');
const pastNames = new Set();
const bbb3Csv = fs.readFileSync(HOME + '/Downloads/SBS BBB Data - BBB 3.csv', 'utf-8').trim().split('\n');
for (const line of bbb3Csv.slice(1)) {
  const [wallet, twitter, discord] = parseCsvLine(line);
  if (wallet && wallet.startsWith('0x')) pastWallets.add(wallet.toLowerCase());
  for (const n of [twitter, discord]) {
    const nn = normName(n);
    if (nn.length >= 4) pastNames.add(nn);
  }
}
// display names from the all-time CSV too
for (const line of pastCsv.slice(1)) {
  const nn = normName(parseCsvLine(line)[1]);
  if (nn.length >= 4) pastNames.add(nn);
}
console.log(`after BBB3 sheet: ${pastWallets.size} wallets, ${pastNames.size} past names`);

// web2_social_identities: past-era email -> old wallet (dateJoined pre-2026 = played before)
const w2 = await db.collection('web2_social_identities').get();
let w2past = 0;
for (const d of w2.docs) {
  const { dateJoined, type } = d.data();
  const year = parseInt(String(dateJoined ?? '').split('-')[0], 10);
  if (type === 'email' && year && year < 2026) {
    pastEmails.add(d.id.replace(/^email:/, '').toLowerCase().trim());
    w2past++;
  }
}
console.log(`web2_social_identities: ${w2.size} docs, ${w2past} pre-2026 emails added`);

// ---------- current users' emails (Privy export) ----------
const privyCsv = fs.readFileSync(HOME + '/Downloads/sbs_privy_emails.csv', 'utf-8').trim().split('\n');
const walletToEmail = new Map();
for (const line of privyCsv.slice(1)) {
  const [email, , wallet] = parseCsvLine(line);
  if (wallet && email) walletToEmail.set(wallet.toLowerCase(), email.toLowerCase().trim());
}
console.log(`privy export: ${walletToEmail.size} wallet->email`);

// ---------- team / test exclusions ----------
const TEAM_WALLETS = new Set([
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard (external)
  '0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae', // Richard (email/social acct)
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris ADMIN
  '0x93e2dc5642722688b2c5431cd7b3584cd97ee175', // Boris (email acct)
  '0xccdf79a51d292cf6de8807abc1bb58d07d26441d', // ops wallet
  '0x4674ade52c8513a5c14bf4adb396209c6d6d2a6a', // borisvagner.eth@gmail.com (no v2_users doc)
]);
const TEAM_NAME_RE = /vagbros|bigrich|banana10194|bananaking99/i;
const TEAM_EMAIL_RE = /vagner|team@sbsfantasy/i;

// known same-human duplicate accounts: alias wallet -> canonical wallet
const WALLET_ALIASES = new Map([
  ['0x0173a84e8cd5d19cb3372814dde4c08b0852e013', '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7'], // Silkyjohnson16 -> Silkyjohnson
  ['0x221deb936a2c7c137d0a6348c5879cc02bbfe2ba', '0xc432ae697dea94f6e9928f3a0828d0a4838b2d61'], // Mincash -> Mincashftw (per Richard 7/12)
]);

// ---------- current users ----------
const usersSnap = await db.collection('v2_users').get();
const byWallet = new Map();
let dupDocs = 0;
for (const d of usersSnap.docs) {
  const u = d.data();
  let wallet = (u.walletAddress ?? d.id).toLowerCase();
  wallet = WALLET_ALIASES.get(wallet) ?? wallet;
  if (byWallet.has(wallet)) {
    dupDocs++;
    const prev = byWallet.get(wallet);
    // keep the doc with a real username / earliest createdAt
    if (!prev.username || (u.username && u.createdAt && u.createdAt < prev.createdAt)) {
      byWallet.set(wallet, { wallet, username: u.username ?? prev.username, createdAt: u.createdAt ?? prev.createdAt, loginMethod: u.loginMethod ?? '' });
    }
    continue;
  }
  byWallet.set(wallet, {
    wallet,
    username: u.username ?? '',
    createdAt: u.createdAt ?? '',
    loginMethod: u.loginMethod ?? '',
  });
}
const users = [...byWallet.values()];
console.log(`v2_users: ${usersSnap.size} docs -> ${users.length} unique wallets (${dupDocs} duplicate docs)`);

// ---------- purchases from v2_activity_events ----------
const purchasesByWallet = new Map(); // wallet -> {qty, usd, payments, methods}
let last = null, paidEvents = 0;
while (true) {
  let q = db.collection('v2_activity_events').where('type', '==', 'pass_purchased').orderBy('__name__').limit(1000);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (!snap.size) break;
  for (const d of snap.docs) {
    const e = d.data();
    if (e.paymentMethod !== 'usdc' && e.paymentMethod !== 'card') continue;
    paidEvents++;
    let w = (e.walletAddress ?? e.userId ?? '').toLowerCase();
    w = WALLET_ALIASES.get(w) ?? w;
    const qty = Number(e.quantity) || 0;
    const rec = purchasesByWallet.get(w) ?? { qty: 0, usd: 0, payments: 0, methods: new Set() };
    rec.qty += qty; rec.usd += qty * 25; rec.payments++; rec.methods.add(e.paymentMethod);
    purchasesByWallet.set(w, rec);
  }
  last = snap.docs[snap.size - 1];
}
const grossAll = [...purchasesByWallet.values()].reduce((s, r) => s + r.usd, 0);
const qtyAll = [...purchasesByWallet.values()].reduce((s, r) => s + r.qty, 0);
console.log(`paid pass_purchased events: ${paidEvents}, buyers: ${purchasesByWallet.size}, passes: ${qtyAll}, gross: $${grossAll}`);

// cross-check vs draftTokens PassType
const paidTok = await db.collection('draftTokens').where('PassType', '==', 'paid').count().get();
console.log(`draftTokens PassType=paid: ${paidTok.data().count} (cross-check)`);

// ---------- classify ----------
const groups = { team: [], junk: [], returning: [], new: [] };
for (const u of users) {
  const email = walletToEmail.get(u.wallet) ?? '';
  const isTeam = TEAM_WALLETS.has(u.wallet) || TEAM_NAME_RE.test(u.username) || TEAM_EMAIL_RE.test(email);
  const isJunk = /^0x0{8,}/.test(u.wallet);
  u.email = email;
  u.buy = purchasesByWallet.get(u.wallet);
  const nn = normName(u.username);
  const nameMatch = !/^banana\d+$/i.test(u.username) && !/^user-0x/i.test(u.username) && nn.length >= 4 && pastNames.has(nn);
  const isPast = pastWallets.has(u.wallet) || (email && pastEmails.has(email)) || nameMatch;
  if (nameMatch && !pastWallets.has(u.wallet) && !(email && pastEmails.has(email))) {
    console.log(`  name-match reclassified as returning: ${u.username}${u.buy ? ' ($' + u.buy.usd + ')' : ''}`);
  }
  if (isTeam) groups.team.push(u);
  else if (isJunk) groups.junk.push(u);
  else if (isPast) groups.returning.push(u);
  else groups.new.push(u);
}

// buyers whose wallet has no v2_users doc — classify them too so their money is counted
const userWallets = new Set(users.map(u => u.wallet));
const orphanBuyers = [...purchasesByWallet.keys()].filter(w => !userWallets.has(w));
for (const w of orphanBuyers) {
  const email = walletToEmail.get(w) ?? '';
  const u = { wallet: w, username: '(no user doc)', createdAt: '', loginMethod: '', email, buy: purchasesByWallet.get(w) };
  const isTeam = TEAM_WALLETS.has(w) || TEAM_EMAIL_RE.test(email);
  const isPast = pastWallets.has(w) || (email && pastEmails.has(email));
  const g = isTeam ? 'team' : isPast ? 'returning' : 'new';
  console.log(`orphan buyer ${w} $${u.buy.usd} -> ${g}`);
  groups[g].push(u);
}

function summarize(label, arr) {
  const buyers = arr.filter(u => u.buy);
  const usd = buyers.reduce((s, u) => s + u.buy.usd, 0);
  const qty = buyers.reduce((s, u) => s + u.buy.qty, 0);
  console.log(`\n${label}: ${arr.length} users | buyers: ${buyers.length} | passes: ${qty} | $${usd}`);
  return { buyers, usd, qty };
}

console.log('\n================ RESULTS ================');
summarize('TEAM/TEST (excluded)', groups.team);
console.log('  ', groups.team.map(u => `${u.username}(${u.wallet.slice(0, 8)}${u.buy ? ' $' + u.buy.usd : ''})`).join(', '));
summarize('JUNK/BOT 0x0000-prefix (excluded)', groups.junk);
summarize('RETURNING (played before)', groups.returning);
const nu = summarize('NEW USERS (never played before)', groups.new);

// full buyer lists
for (const [label, arr] of [['NEW', groups.new], ['RETURNING', groups.returning]]) {
  const buyers = arr.filter(u => u.buy).sort((a, b) => b.buy.usd - a.buy.usd);
  console.log(`\nALL ${label} BUYERS (${buyers.length}):`);
  for (const u of buyers) {
    console.log(`  ${(u.username || u.wallet.slice(0, 10)).padEnd(20)} $${String(u.buy.usd).padEnd(6)} ${u.buy.qty} passes, ${u.buy.payments} payments [${[...u.buy.methods].join('+')}]`);
  }
}
const newBuyers = nu.buyers.sort((a, b) => b.buy.usd - a.buy.usd);
const dist = {};
for (const u of newBuyers) {
  const bucket = u.buy.usd <= 25 ? '$25' : u.buy.usd <= 100 ? '$26-100' : u.buy.usd <= 500 ? '$101-500' : '$500+';
  dist[bucket] = (dist[bucket] ?? 0) + 1;
}
console.log('\nNew-buyer spend distribution:', JSON.stringify(dist));

// signups over time for new users
const byWeek = {};
for (const u of groups.new) {
  const wk = String(u.createdAt).slice(0, 10);
  byWeek[wk.slice(0, 7)] = (byWeek[wk.slice(0, 7)] ?? 0) + 1;
}
console.log('New signups by month:', JSON.stringify(byWeek));

// save full CSV
let csv = 'wallet,username,email,created,status,payments,passes_bought,usd\n';
for (const [status, arr] of Object.entries(groups)) {
  for (const u of arr) {
    csv += `${u.wallet},"${u.username}","${u.email}",${String(u.createdAt).slice(0, 10)},${status},${u.buy?.payments ?? 0},${u.buy?.qty ?? 0},${u.buy?.usd ?? 0}\n`;
  }
}
fs.writeFileSync(HOME + '/Downloads/sbs_new_vs_returning_2026-07-12.csv', csv);
console.log('\nCSV saved: ~/Downloads/sbs_new_vs_returning_2026-07-12.csv');
