import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const ROSTER = /^(QB|RB|WR|TE|DST)\d+$/i;

// A) sample a REGULAR draft finalize doc for format comparison
const regular = await db.collection('draftTokenMetadata').doc('2217').get(); // RyRo BBB #162
console.log('=== regular doc draftTokenMetadata/2217 ===');
(regular.get('Attributes') ?? []).filter(a => ROSTER.test(String(a.Trait_Type ?? ''))).slice(0, 15)
  .forEach(a => console.log(`  ${a.Trait_Type}: ${JSON.stringify(a.Value ?? a.value)}`));

// B) marketplace_index for 2639 — stored image/players?
const ix = await db.collection('marketplace_index').doc('2639').get();
const d = ix.data() ?? {};
console.log('\n=== marketplace_index/2639 ===');
console.log('  status:', d.status, '| level:', d.level);
console.log('  image:', String(d.image ?? '').slice(0, 110));
console.log('  players:', Array.isArray(d.players) ? JSON.stringify(d.players.slice(0, 4)) : 'none');

// C) all wheel-linked tokens (nft_league_map by cron/backfill) — same dash format?
const maps = await db.collection('nft_league_map').get();
console.log('\n=== wheel-linked tokens (nft_league_map) ===', maps.size);
for (const m of maps.docs) {
  const md = await db.collection('draftTokenMetadata').doc(m.id).get();
  const attrs = (md.get('Attributes') ?? []).filter(a => ROSTER.test(String(a.Trait_Type ?? '')));
  const vals = attrs.map(a => String(a.Value ?? a.value ?? ''));
  const dashy = vals.filter(v => !v.includes(' ') && v.includes('-')).length;
  console.log(`  ${m.id} league=${m.data().leagueId} mappedBy=${m.data().mappedBy ?? 'backfill'} attrs=${attrs.length} dashFormat=${dashy}/${vals.length} e.g. ${JSON.stringify(vals.slice(0, 3))}`);
}
process.exit(0);
