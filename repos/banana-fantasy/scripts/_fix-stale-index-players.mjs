// marketplace_index/{id}.players is a durable pick list resolveCard TRUSTS (hasPicks → build image from it).
// After a void+re-enter, it can hold the OLD league's roster. Detect: index players (team+pos set) vs the
// token's CURRENT roster in draftTokenMetadata attrs; if the current draft is in progress (attrs roster<10)
// a 10+ player index list is stale by definition. Fix = drop players/roster/image/leagueNumber (self-heals).
// Dry-run default; CONFIRM=1 to write.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
initializeApp({ credential: cert(JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json','utf8'))) });
const db = getFirestore();
const CONFIRM = process.env.CONFIRM === '1';
const ROSTER_RE = /^(QB|RB|WR|TE|DST)\d*$/i;
const norm = s => String(s||'').toUpperCase().replace(/[-\s]+/g,' ').trim();
const teamIx = await db.collection('marketplace_index').where('status','==','team').get();
const withPlayers = teamIx.docs.filter(d => Array.isArray(d.data().players) && d.data().players.length >= 10);
console.log('team index docs:', teamIx.size, 'with players>=10:', withPlayers.length);
const ids = withPlayers.map(d => d.id);
const tok = new Map(), md = new Map();
for (let i = 0; i < ids.length; i += 300) {
  const [ts, ms] = await Promise.all([db.getAll(...ids.slice(i,i+300).map(id => db.doc(`draftTokens/${id}`))), db.getAll(...ids.slice(i,i+300).map(id => db.doc(`draftTokenMetadata/${id}`)))]);
  ts.forEach(s => tok.set(s.id, s.data()||{})); ms.forEach(s => md.set(s.id, s.data()||{}));
}
const stale = [];
for (const d of withPlayers) {
  const ix = d.data(); const t = tok.get(d.id)||{}; const attrs = (md.get(d.id)?.Attributes||md.get(d.id)?.attributes||[]);
  const league = (attrs.find(a => String(a.Trait_Type||a.trait_type).toUpperCase()==='LEAGUE-NAME')?.Value ?? '') || '';
  if (/wheel/i.test(league)) continue; // wheel teams: separate pipeline, don't judge
  const cur = new Set(attrs.filter(a => ROSTER_RE.test(String(a.Trait_Type||a.trait_type||''))).map(a => norm(a.Value??a.value)).filter(Boolean));
  const ixSet = new Set(ix.players.map(p => norm(`${p.team} ${p.pos}`)));
  const curNo = (t.LeagueDisplayName||'').match(/#(\d+)/)?.[1];
  let why = null;
  if (!t.LeagueId) why = 'not in a league';
  else if (cur.size < 10) why = `draft in progress (${cur.size} roster attrs) but index has ${ixSet.size} players`;
  else { let overlap = 0; for (const x of ixSet) if (cur.has(x)) overlap++; if (overlap < 12) why = `index players ≠ current roster (overlap ${overlap}/15)`; }
  if (!why && curNo && ix.leagueNumber != null && String(ix.leagueNumber) !== curNo) why = `index league ${ix.leagueNumber} ≠ current ${curNo}`;
  if (why) stale.push({ id: d.id, go: t.LeagueDisplayName||'(none)', ixLeague: ix.leagueNumber ?? '-', why });
}
console.table(stale);
if (!CONFIRM) { console.log('DRY RUN', stale.length); process.exit(0); }
for (const s of stale) await db.doc(`marketplace_index/${s.id}`).set({ players: FieldValue.delete(), roster: FieldValue.delete(), image: FieldValue.delete(), leagueNumber: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
console.log('cleared', stale.length);
const key = readFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/.env.prod','utf8').match(/^OPENSEA_API_KEY="?([^"\n]+)/m)?.[1];
for (const s of stale) {
  const me = await fetch(`https://sbsfantasy.com/api/nft/metadata/${s.id}`, { cache: 'no-store' }).then(r => r.json()).catch(e => ({}));
  const r = await fetch(`https://api.opensea.io/api/v2/chain/base/contract/0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80/nfts/${s.id}/refresh`, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': key } });
  console.log(s.id, me.name, [(me.attributes||[]).find(a=>a.trait_type==='League #')?.value], 'opensea', r.status);
  await new Promise(r => setTimeout(r, 600));
}
process.exit(0);
