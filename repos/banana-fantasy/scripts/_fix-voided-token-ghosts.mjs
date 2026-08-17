// Ghost teams: tokens NOT in a league (draftTokens.LeagueId == '') whose marketplace_index still
// says status=team and/or whose draftTokenMetadata still carries a full roster (from a voided draft).
// The metadata route re-heals the index FROM those attrs on every view, so it never self-clears.
// Fix: index -> status 'pass' (drop players/roster/leagueNumber/image), metadata -> strip roster attrs
// + LEAGUE-NAME/RANK/scores reset + Image cleared, then OpenSea refresh.
// Dry-run default; CONFIRM=1 to write.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
initializeApp({ credential: cert(JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json','utf8'))) });
const db = getFirestore();
const CONFIRM = process.env.CONFIRM === '1';
const ROSTER_RE = /^(QB|RB|WR|TE|DST)\d+$/i;

const unstamped = new Set();
{ const q = await db.collection('draftTokens').where('LeagueId', '==', '').select('LeagueId').get(); q.forEach(d => unstamped.add(d.id)); }
console.log('draftTokens with LeagueId "":', unstamped.size);
const teamIx = await db.collection('marketplace_index').where('status', '==', 'team').get();
console.log('marketplace_index status=team:', teamIx.size);
const ghosts = [];
for (const d of teamIx.docs) if (unstamped.has(d.id)) ghosts.push({ id: d.id, ix: d.data() });
console.log('index=team but not in a league:', ghosts.length);
// metadata check for those + any unstamped token w/ roster attrs but index not team (belt & braces)
const mdRefs = [...unstamped].map(id => db.doc(`draftTokenMetadata/${id}`));
const mdDocs = [];
for (let i = 0; i < mdRefs.length; i += 300) mdDocs.push(...await db.getAll(...mdRefs.slice(i, i + 300)));
const mdGhost = new Map();
for (const s of mdDocs) {
  if (!s.exists) continue;
  const attrs = (s.data().Attributes || s.data().attributes || []);
  const roster = attrs.filter(a => ROSTER_RE.test(String(a.Trait_Type || a.trait_type || '')) && String(a.Value ?? a.value ?? '').trim());
  if (roster.length >= 10) mdGhost.set(s.id, { attrs, league: attrs.find(a => String(a.Trait_Type||a.trait_type).toUpperCase()==='LEAGUE-NAME')?.Value ?? '' });
}
console.log('metadata roster>=10 but not in a league:', mdGhost.size);
const all = new Map();
for (const g of ghosts) all.set(g.id, { ...g, md: mdGhost.get(g.id) });
for (const [id, md] of mdGhost) if (!all.has(id)) all.set(id, { id, ix: null, md });
// wheel-won JP/HOF teams legitimately have LeagueId '' on draftTokens — NEVER touch those
for (const [id, g] of [...all]) if (/wheel/i.test(String(g.md?.league || '')) || /wheel/i.test(String(g.ix?.leagueName || ''))) all.delete(id);
console.log('real ghosts (non-wheel):', all.size);
// which drafts are they from
const rows = [...all.values()].map(g => ({ id: g.id, ixLeague: g.ix?.leagueNumber ?? null, ixStatus: g.ix?.status ?? '-', mdLeague: g.md?.league ?? '-', mdRoster: g.md ? 'yes' : 'no' }));
rows.sort((a,b)=>+a.id-+b.id);
console.table(rows);
if (!CONFIRM) { console.log('DRY RUN — set CONFIRM=1 to fix', rows.length, 'tokens'); process.exit(0); }

let n = 0;
for (const g of all.values()) {
  const b = db.batch();
  b.set(db.doc(`marketplace_index/${g.id}`), { tokenId: g.id, status: 'pass', players: FieldValue.delete(), roster: FieldValue.delete(), leagueNumber: FieldValue.delete(), image: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), voidedFrom: g.ix?.leagueNumber ?? g.md?.league ?? null }, { merge: true });
  if (g.md) {
    const attrs = g.md.attrs.map(a => {
      const tt = String(a.Trait_Type || a.trait_type || '').toUpperCase();
      const key = a.Trait_Type != null ? 'Value' : 'value';
      if (ROSTER_RE.test(tt)) return null; // drop roster slots
      if (['LEAGUE-NAME','LEAGUE-RANK'].includes(tt)) return { ...a, [key]: '' };
      if (['WEEK-SCORE','SEASON-SC0RE','SEASON-SCORE'].includes(tt)) return { ...a, [key]: '0' };
      if (tt === 'RANK') return { ...a, [key]: 'N/A' };
      if (tt === 'PRIZES') return { ...a, [key]: '0.000000 ETH' };
      return a;
    }).filter(Boolean);
    b.set(db.doc(`draftTokenMetadata/${g.id}`), { Attributes: attrs, Image: '' }, { merge: true });
  }
  await b.commit(); n++;
}
console.log('fixed', n);
// OpenSea refresh
const key = readFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/.env.prod','utf8').match(/^OPENSEA_API_KEY="?([^"\n]+)/m)?.[1];
const CONTRACT = readFileSync('lib/contracts/bbb4.ts','utf8').match(/BBB4_CONTRACT_ADDRESS[^'"]*['"](0x[0-9a-fA-F]{40})/)[1];
console.log('contract', CONTRACT, 'key', key ? 'yes' : 'NO');
for (const id of all.keys()) {
  // warm our own metadata first (so OpenSea's fetch sees the pass)
  const me = await fetch(`https://sbsfantasy.com/api/nft/metadata/${id}`, { cache: 'no-store' }).then(r => r.json()).catch(e => ({ error: String(e) }));
  const r = await fetch(`https://api.opensea.io/api/v2/chain/base/contract/${CONTRACT}/nfts/${id}/refresh`, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': key } });
  console.log(id, 'ours:', me.name, '| opensea refresh:', r.status);
  await new Promise(r => setTimeout(r, 600));
}
process.exit(0);
