import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const HOME = process.env.HOME;
const saJson = JSON.parse(fs.readFileSync(HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

// engaged new users with auto/anonymous names from the engaged CSV
const rows = fs.readFileSync(HOME + '/Downloads/sbs_engaged_users_2026-07-12.csv', 'utf-8').trim().split('\n').slice(1)
  .map(l => {
    const m = l.match(/^([^,]+),"([^"]*)","([^"]*)",([^,]*),([^,]+),([^,]+),(\d+),(\d+),(\d+)$/);
    return m && { wallet: m[1], username: m[2], email: m[3], created: m[4], status: m[5], eng: m[6], usd: +m[9] };
  }).filter(Boolean);
const targets = rows.filter(r => r.status === 'new' && (/^banana\d+$/i.test(r.username) || r.username === '(no user doc)' || /^user-0x/i.test(r.username)));
console.log(`auditing ${targets.length} anonymous new accounts (Banana#### / User-0x / no-doc)\n`);

// privy export lookup (email + source + signup) by wallet
const privy = new Map();
for (const line of fs.readFileSync(HOME + '/Downloads/sbs_privy_emails.csv', 'utf-8').trim().split('\n').slice(1)) {
  const [email, source, wallet, signed] = line.split(',');
  if (wallet) privy.set(wallet.toLowerCase(), { email, source, signed });
}

const LAUNCH = '2026-06-22';
for (const t of targets.sort((a, b) => b.usd - a.usd || (a.created || '').localeCompare(b.created || ''))) {
  const u = await db.collection('v2_users').doc(t.wallet).get();
  const ud = u.exists ? u.data() : {};
  const p = privy.get(t.wallet);
  // all activity events for this wallet
  const ev = await db.collection('v2_activity_events').where('walletAddress', '==', t.wallet).get();
  const evs = ev.docs.map(d => d.data()).sort((a, b) => (a.createdAtIso ?? '').localeCompare(b.createdAtIso ?? ''));
  const buys = evs.filter(e => e.type === 'pass_purchased' && (e.paymentMethod === 'usdc' || e.paymentMethod === 'card'));
  const uas = [...new Set(evs.map(e => e.userAgent).filter(Boolean))];
  const created = ud.createdAt ?? t.created ?? '';
  const preLaunch = created && String(created).slice(0, 10) < LAUNCH;
  console.log(`${t.username} ${t.wallet}`);
  console.log(`  $${t.usd} | created: ${String(created).slice(0, 16) || 'UNKNOWN (early)'}${preLaunch ? '  ⚠️ PRE-LAUNCH' : ''} | login: ${ud.loginMethod ?? '?'}`);
  console.log(`  privy: ${p ? `${p.email} (${p.source}, ${p.signed})` : 'NOT in 7/9 export (wallet/twitter-only, or joined after 7/9)'}`);
  if (buys.length) {
    for (const b of buys) console.log(`  buy: ${String(b.createdAtIso).slice(0, 16)} qty=${b.quantity} ${b.paymentMethod} tx=${(b.txHash ?? '').slice(0, 14)}`);
  }
  console.log(`  events: ${evs.length} (${[...new Set(evs.map(e => e.type))].join(',')}) | platforms: ${[...new Set(evs.map(e => e.devicePlatform).filter(x => x && x !== 'unknown'))].join(',') || '?'}`);
  if (uas.length) console.log(`  UA: ${uas.map(x => x.slice(0, 80)).join(' || ').slice(0, 200)}`);
  console.log('');
}
