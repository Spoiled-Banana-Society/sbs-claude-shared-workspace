import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const wallets = [
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
  '0x6681d98e65e33522374a3876e29183eaab8aa711',
  '0x014a3bc94c1c753adf14b1ead8758a8bb55dc191',
  '0x77aae124683a75013df8ab7f0fde5193b0034f42',
  '0xc7900ed9d6b3f252fe5cd151dce67db3ff349b2e',
  '0xe7259addf13489b4fc37ebde0d8fe523cd38bed1',
  '0x19b3cc05226775552b7dd4969743678affb0efdf',
  '0xebc6103ef0cb4d0d6ef917cd6b8b9caa935cbfc7',
  '0xeab34d772d0fc63cd89b58772de0c1cfaebdc7d4',
  '0xc0d1c2e08294060ba4427c5df0cac1bc28e1a265',
];

console.log('=== v2_users profile for each of the 10 wallets in draft 821 ===');
for (const w of wallets) {
  let found = null, foundId = null;
  for (const id of [w, w.toLowerCase()]) {
    const u = await fs.collection('v2_users').doc(id).get();
    if (u.exists) { found = u.data() || {}; foundId = id; break; }
  }
  if (!found) { console.log(`  ${w}  -> NO v2_users doc`); continue; }
  const d = found;
  console.log(`  ${w}`);
  console.log(`    username=${JSON.stringify(d.username)}  nflTeam=${JSON.stringify(d.nflTeam)}  draftPasses=${d.draftPasses}  cardPurchaseCount=${d.cardPurchaseCount}`);
  console.log(`    pfp=${(d.profilePicture||d.pfp||d.PFP||'').toString().slice(0,60)}  email=${d.email||d.privyEmail||''}  createdVia=${d.loginMethod||d.authProvider||''}`);
}
process.exit(0);
