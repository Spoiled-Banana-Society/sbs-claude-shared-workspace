import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const src = readFileSync('data/nfl-players.ts', 'utf8');
const TEAM_PLAYERS = eval('(' + src.match(/const TEAM_PLAYERS[^=]*=\s*({[\s\S]*?});/)[1] + ')');
const slotName = (slotId) => {
  const m = slotId.match(/^([A-Z]{2,3})[- ](QB|RB1|RB2|WR1|WR2|TE|DST)$/);
  if (!m) return slotId;
  return TEAM_PLAYERS[m[1]]?.[m[2]]?.[0] || slotId;
};

const bots = new Set((await db.collection('botWallets').listDocuments()).map(d => d.id.toLowerCase()));
const ids = (await db.collection('drafts').listDocuments()).map(d => d.id).filter(id => id.startsWith('2026-'));
console.log('bots:', bots.size, '2026 drafts:', ids.length);

const drafts = []; // {id, name, picks:[{pick, round, slot, owner, bot}]}
for (let i = 0; i < ids.length; i += 25) {
  await Promise.all(ids.slice(i, i + 25).map(async id => {
    const [sum, info] = await Promise.all([
      db.collection('drafts').doc(id).collection('state').doc('summary').get(),
      db.collection('drafts').doc(id).collection('state').doc('info').get(),
    ]);
    const rows = sum.data()?.Summary ?? [];
    const picks = [];
    for (const r of rows) {
      const p = r?.PlayerInfo; if (!p?.OwnerAddress || !p?.PlayerId) continue;
      picks.push({ pick: p.PickNum, round: p.Round, slot: p.PlayerId.replace(' ', '-'), owner: p.OwnerAddress.toLowerCase(), bot: bots.has(p.OwnerAddress.toLowerCase()) });
    }
    if (picks.length < 20) return;
    drafts.push({ id, name: info.data()?.DisplayName || id, complete: picks.length >= 150, picks });
  }));
}
console.log('drafts w/ picks:', drafts.length, 'complete:', drafts.filter(d=>d.complete).length);

// order drafts by BBB number; rolling ADP over +-W COMPLETE neighbors (excluding self); undrafted = 151
const bbb = n => +(String(n).match(/#(\d+)/)?.[1] ?? 1e9);
drafts.sort((a, b) => bbb(a.name) - bbb(b.name));
const comp = drafts.filter(d => d.complete);
const allSlots = new Set(); for (const d of drafts) for (const p of d.picks) allSlots.add(p.slot);
const slotList = [...allSlots];
const pickMap = comp.map(d => new Map(d.picks.map(p => [p.slot, p.pick])));
const W = 40, REACH = 40, MAXPICK = 110;
const flagged = [];
for (const d of drafts) {
  // index of nearest complete draft by bbb order
  let ci = 0; for (let j = 0; j < comp.length; j++) if (bbb(comp[j].name) <= bbb(d.name)) ci = j;
  const lo = Math.max(0, ci - W), hi = Math.min(comp.length - 1, ci + W);
  const adp = {};
  for (const s of slotList) {
    let sum = 0, n = 0;
    for (let j = lo; j <= hi; j++) { if (comp[j] === d) continue; sum += pickMap[j].get(s) ?? 151; n++; }
    adp[s] = sum / n;
  }
  d.adpAt = {}; for (const p of d.picks) d.adpAt[p.slot] = +adp[p.slot].toFixed(1);
  for (const p of d.picks) {
    if (p.bot) continue;
    const reach = adp[p.slot] - p.pick;
    if (p.pick <= MAXPICK && reach >= REACH) flagged.push({ draft: d.id, name: d.name + (d.complete ? '' : '*'), ...p, adp: +adp[p.slot].toFixed(1), reach: +reach.toFixed(1), player: slotName(p.slot) });
  }
}
console.log('flagged human picks (rolling ADP W=%d, reach>=%d, pick<=%d):', W, REACH, MAXPICK, flagged.length);

// per draft+owner aggregation
const byDO = {};
for (const f of flagged) {
  const k = f.draft + '|' + f.owner;
  (byDO[k] ||= { draft: f.draft, name: f.name, owner: f.owner, bot: f.bot, n: 0, sum: 0, picks: [] });
  byDO[k].n++; byDO[k].sum += f.reach; byDO[k].picks.push(f);
}
const rowsDO = Object.values(byDO).sort((a, b) => b.sum - a.sum);
const owners = [...new Set(rowsDO.slice(0, 80).map(r => r.owner))];
const users = {};
await Promise.all(owners.map(async o => { const u = await db.collection('v2_users').doc(o).get(); users[o] = u.data()?.username || o.slice(0, 10); }));

console.log('\n== worst drafter-in-draft (sum of reach over flagged picks) ==');
for (const r of rowsDO.slice(0, 60)) {
  console.log(`${r.name.padEnd(10)} ${(users[r.owner]||r.owner.slice(0,10)).padEnd(18)}${r.bot?'BOT ':'    '} n=${r.n} sum=${r.sum.toFixed(0)} | ` +
    r.picks.sort((a,b)=>a.pick-b.pick).map(p => `${p.player}@${p.pick}(adp ${p.adp})`).join(', '));
}

// per owner across drafts (repeat offenders)
const byO = {};
for (const r of rowsDO) { if (r.bot) continue; (byO[r.owner] ||= { n: 0, drafts: new Set(), sum: 0 }); byO[r.owner].n += r.n; byO[r.owner].sum += r.sum; byO[r.owner].drafts.add(r.draft); }
// teams per owner for rate
const teams = {};
for (const d of comp) for (const o of new Set(d.picks.map(p => p.owner))) teams[o] = (teams[o] || 0) + 1;
const repeat = Object.entries(byO).map(([o, v]) => ({ o, ...v, drafts: v.drafts.size, teams: teams[o] })).filter(r => r.n >= 3).sort((a, b) => b.n / b.teams - a.n / a.teams);
const more = repeat.slice(0, 30).map(r => r.o).filter(o => !users[o]);
await Promise.all(more.map(async o => { const u = await db.collection('v2_users').doc(o).get(); users[o] = u.data()?.username || o.slice(0, 10); }));
console.log('\n== repeat reachers (human, >=3 flagged picks) : flagged picks / teams ==');
for (const r of repeat.slice(0, 30)) console.log(`${(users[r.o]||r.o.slice(0,10)).padEnd(18)} ${r.n} flagged in ${r.drafts} drafts / ${r.teams} teams (${(r.n/r.teams).toFixed(2)}/team) sumreach=${r.sum.toFixed(0)}`);

// boards for every draft with a flagged pick
const flaggedDrafts = new Set(flagged.map(f => f.draft));
const boards = [];
const allOwners = new Set();
for (const d of drafts) if (flaggedDrafts.has(d.id)) for (const p of d.picks) allOwners.add(p.owner);
const missing = [...allOwners].filter(o => !users[o]);
for (let i = 0; i < missing.length; i += 50) await Promise.all(missing.slice(i, i + 50).map(async o => { const u = await db.collection('v2_users').doc(o).get(); users[o] = u.data()?.username || o.slice(0, 10); }));
for (const d of drafts) {
  if (!flaggedDrafts.has(d.id)) continue;
  const fl = flagged.filter(f => f.draft === d.id);
  boards.push({ id: d.id, name: d.name, complete: d.complete, score: fl.reduce((a, f) => a + f.reach, 0), maxReach: Math.max(...fl.map(f => f.reach)), nFlags: fl.length,
    picks: d.picks.map(p => ({ pick: p.pick, round: p.round, slot: p.slot, player: slotName(p.slot), owner: p.owner, user: users[p.owner] || p.owner.slice(0, 10), bot: p.bot, adp: d.adpAt[p.slot], reach: +(d.adpAt[p.slot] - p.pick).toFixed(1) })) });
}
boards.sort((a, b) => b.score - a.score);
writeFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/boards.json', JSON.stringify(boards));
console.log('boards:', boards.length);
writeFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/reaches.json', JSON.stringify({ flagged, rowsDO, users, teams }, null, 1));
process.exit(0);
