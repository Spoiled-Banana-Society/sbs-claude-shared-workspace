/**
 * Heal draft 793 dupe-pick corruption (thaytrader, 2026-08-25). Pool truth:
 * pick 89 = LAC-QB, pick 112 = GB-QB (summary/rosters had them as KC-TE /
 * LAC-TE). 7-store recipe from the 2026-08-09 heal (project memory).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const W = '0x84df49b1d4fdcee1e3b410669b7e5087412b411b';
const D = '2026-fast-draft-793';
const TOKEN = '9791';
const FIXES = [
  { pickNum: 89, round: 9, wrong: 'KC-TE', right: { PlayerId: 'LAC-QB', DisplayName: 'LAC-QB', Team: 'LAC', Position: 'QB' } },
  { pickNum: 112, round: 12, wrong: 'LAC-TE', right: { PlayerId: 'GB-QB', DisplayName: 'GB-QB', Team: 'GB', Position: 'QB' } },
];

// 1) summary
{
  const ref = db.doc(`drafts/${D}/state/summary`);
  const arr = (await ref.get()).data().Summary;
  let fixed = 0;
  for (const e of arr) {
    const p = e.PlayerInfo;
    const f = FIXES.find(f => Number(p.PickNum) === f.pickNum);
    if (f && p.PlayerId === f.wrong && String(p.OwnerAddress).toLowerCase() === W) {
      Object.assign(p, f.right, { PickNum: f.pickNum, Round: f.round, OwnerAddress: p.OwnerAddress });
      fixed++;
    }
  }
  await ref.update({ Summary: arr });
  console.log('1 summary fixed:', fixed);
}
// 2) rosters
{
  const ref = db.doc(`drafts/${D}/state/rosters`);
  const data = (await ref.get()).data();
  const rosters = data.Rosters;
  const key = Object.keys(rosters).find(k => k.toLowerCase() === W);
  const mine = rosters[key];
  // drop phantom KC-TE dupe + LAC-TE; ensure QB has LAC-QB + GB-QB
  mine.TE = (mine.TE ?? []).filter(p => p.PlayerId !== 'LAC-TE');
  const kcCount = mine.TE.filter(p => p.PlayerId === 'KC-TE').length;
  if (kcCount > 1) { let seen = false; mine.TE = mine.TE.filter(p => p.PlayerId !== 'KC-TE' || (!seen && (seen = true))); }
  mine.QB = mine.QB ?? [];
  for (const f of FIXES) {
    if (!mine.QB.some(p => p.PlayerId === f.right.PlayerId)) mine.QB.push({ PlayerId: f.right.PlayerId, DisplayName: f.right.DisplayName, Team: f.right.Team });
  }
  await ref.update({ Rosters: rosters });
  console.log('2 rosters fixed → QB:', mine.QB.map(p => p.PlayerId).join(','), '| TE:', mine.TE.map(p => p.PlayerId).join(','));
}
// 3/4/6) card, draftTokens, usedDraftTokens — same Roster{POS:[]} shape fix
for (const path of [`drafts/${D}/cards/${TOKEN}`, `draftTokens/${TOKEN}`, `owners/${W}/usedDraftTokens/${TOKEN}`]) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists) { console.log(path, 'MISSING — skipped'); continue; }
  const d = snap.data();
  const roster = d.Roster ?? d.roster;
  if (!roster) { console.log(path, 'no roster field — keys:', Object.keys(d).join(',').slice(0, 100)); continue; }
  const te = (roster.TE ?? []).filter(p => (p.PlayerId ?? p.playerId) !== 'LAC-TE');
  let seen = false;
  roster.TE = te.filter(p => (p.PlayerId ?? p.playerId) !== 'KC-TE' || (!seen && (seen = true)));
  roster.QB = roster.QB ?? [];
  for (const f of FIXES) {
    if (!roster.QB.some(p => (p.PlayerId ?? p.playerId) === f.right.PlayerId)) {
      const sample = roster.QB[0] ?? {};
      const lower = 'playerId' in sample;
      roster.QB.push(lower ? { playerId: f.right.PlayerId, displayName: f.right.DisplayName, team: f.right.Team } : { PlayerId: f.right.PlayerId, DisplayName: f.right.DisplayName, Team: f.right.Team });
    }
  }
  await ref.update(d.Roster ? { Roster: roster } : { roster });
  console.log(path, 'fixed → QB:', roster.QB.length, 'TE:', roster.TE.length);
}
// 7) marketplace_index
{
  const ref = db.doc(`marketplace_index/${TOKEN}`);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data();
    for (const fld of ['players', 'roster']) {
      if (Array.isArray(d[fld])) {
        let seenKC = false;
        d[fld] = d[fld].filter(x => {
          const id = typeof x === 'string' ? x : (x.playerId ?? x.PlayerId);
          if (id === 'LAC-TE') return false;
          if (id === 'KC-TE') { if (seenKC) return false; seenKC = true; }
          return true;
        });
        for (const f of FIXES) {
          const has = d[fld].some(x => (typeof x === 'string' ? x : (x.playerId ?? x.PlayerId)) === f.right.PlayerId);
          if (!has) d[fld].push(typeof d[fld][0] === 'string' ? f.right.PlayerId : { playerId: f.right.PlayerId, team: f.right.Team, position: f.right.Position });
        }
        seenKC = false;
      }
    }
    await ref.update({ players: d.players ?? admin.firestore.FieldValue.delete(), roster: d.roster ?? admin.firestore.FieldValue.delete() });
    console.log('7 marketplace_index fixed');
  } else console.log('7 marketplace_index missing — skipped');
}
console.log('done — now regen metadata + refresh-draft');
process.exit(0);
