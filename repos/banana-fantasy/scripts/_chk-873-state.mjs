import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ix = await db.collection('marketplace_index').doc('873').get();
const d = ix.data() ?? {};
console.log('marketplace_index/873: status=', d.status, 'level=', d.level, 'leagueNumber=', d.leagueNumber, 'teamNumber=', d.teamNumber ?? d.teamNo);
console.log('  image:', String(d.image ?? '').slice(0, 100));

const map = await db.collection('nft_league_map').doc('873').get();
console.log('nft_league_map/873:', JSON.stringify(map.data()));

const meta = await db.collection('draftTokenMetadata').doc('873').get();
console.log('draftTokenMetadata/873 Name:', meta.get('Name'), '| first attrs:',
  JSON.stringify((meta.get('Attributes') ?? []).slice(0, 4)));

const dt = await db.collection('draftTokens').doc('873').get();
console.log('draftTokens/873:', dt.exists ? `LeagueId=${dt.get('LeagueId') ?? dt.get('_leagueId')} Owner=${(dt.get('OwnerId') ?? dt.get('_ownerId') ?? '').slice(0,10)}` : 'missing');

// queue seat check — does any hof queue round still reference 873?
const q = await db.collection('v2_queues').doc('hof').get();
for (const r of (q.data()?.rounds ?? [])) {
  for (const m of (r.members ?? [])) {
    if (String(m.tokenId) === '873' || String(m.tokenId) === '2639') {
      console.log(`queue hof round ${r.roundId} status=${r.status} draftId=${r.draftId}: member tokenId=${m.tokenId} wallet=${m.wallet.slice(0,10)}`);
    }
  }
}
process.exit(0);
