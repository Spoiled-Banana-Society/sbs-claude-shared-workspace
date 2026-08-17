import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
initializeApp({ credential: cert(JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json','utf8'))) });
const db = getFirestore();
const src = readFileSync('data/nfl-players.ts', 'utf8');
const TEAM_PLAYERS = eval('(' + src.match(/const TEAM_PLAYERS[^=]*=\s*({[\s\S]*?});/)[1] + ')');
const slotName = (s) => { const m = s.match(/^([A-Z]{2,3})[- ](QB|RB1|RB2|WR1|WR2|TE|DST)$/); return m ? (TEAM_PLAYERS[m[1]]?.[m[2]]?.[0] || s) : s; };
const R = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/reaches.json','utf8'));
// season ADP from playerMap for reference
const pm = (await db.collection('playerStats2026').doc('playerMap').get()).data()?.Players || {};
const adpOf = id => pm[id]?.ADPExact ?? pm[id]?.ADP ?? null;

const targets = R.rowsDO.slice(0, 8);
const csv = ['draft,drafter,wallet,pick,round,player,slot,seasonADP,reachVsSeasonADP'];
for (const t of targets) {
  const sum = await db.collection('drafts').doc(t.draft).collection('state').doc('summary').get();
  const rows = (sum.data()?.Summary || []).map(r => r.PlayerInfo).filter(p => p?.OwnerAddress?.toLowerCase() === t.owner);
  const u = (await db.collection('v2_users').doc(t.owner).get()).data() || {};
  const name = R.users[t.owner] || u.username || t.owner.slice(0,10);
  const paidTeams = 0;
  console.log(`\n=== ${t.name} (${t.draft}) — ${name} ${t.owner} | teams=${R.teams[t.owner]} | created=${u.createdAt?.toDate?.()?.toISOString?.().slice(0,10) || u.createdAt || u.firstLoginAt || '?'} | login=${u.loginMethod || u.authType || u.walletType || '?'} | country=${u.ipCountry || u.country || '?'}`);
  for (const p of rows.sort((a,b)=>a.PickNum-b.PickNum)) {
    const slot = p.PlayerId.replace(' ','-'); const a = adpOf(p.PlayerId) ?? adpOf(slot);
    const reach = a != null ? (a - p.PickNum).toFixed(0) : '?';
    const flag = a != null && a - p.PickNum >= 40 && p.PickNum <= 110 ? '  <<<' : '';
    console.log(`  R${String(p.Round).padStart(2)} #${String(p.PickNum).padStart(3)}  ${slotName(slot).padEnd(22)} ${slot.padEnd(8)} seasonADP ${a==null?'?':a.toFixed(0).padStart(3)}  (${reach>0?'+':''}${reach})${flag}`);
    csv.push([t.name, name, t.owner, p.PickNum, p.Round, slotName(slot), slot, a?.toFixed(1), reach].join(','));
  }
}
// also: full flagged list to CSV
const all = ['draft,drafter,wallet,pick,round,player,slot,rollingADP,reach'];
for (const f of R.flagged.filter(f=>!f.bot).sort((a,b)=>b.reach-a.reach)) all.push([f.name, R.users[f.owner]||f.owner.slice(0,10), f.owner, f.pick, f.round, f.player, f.slot, f.adp, f.reach].join(','));
writeFileSync('/Users/richardvagner/Downloads/adp-reaches-2026-08-17.csv', all.join('\n'));
writeFileSync('/Users/richardvagner/Downloads/adp-reaches-top-rosters-2026-08-17.csv', csv.join('\n'));
process.exit(0);
