#!/usr/bin/env node
// BANANA RACE switch — system_config/bananaRace. READ-ONLY unless a flag is given.
//
//   node scripts/_banana-race-toggle.mjs                     # show config + live tally summary
//   node scripts/_banana-race-toggle.mjs --on                # enable (stamps launchAtIso once)
//   node scripts/_banana-race-toggle.mjs --off               # disable (page + tile go dark; nothing else touched)
//   node scripts/_banana-race-toggle.mjs --start 2026-09-05T07:00:00Z   # points window start (UTC)
//   node scripts/_banana-race-toggle.mjs --end   2026-09-09T00:00:00Z   # points close / freeze (UTC)
//   node scripts/_banana-race-toggle.mjs --draft 2026-09-09T01:00:00Z   # draft time shown on the page (UTC)
//   node scripts/_banana-race-toggle.mjs --topn 10
//   node scripts/_banana-race-toggle.mjs --unfreeze          # undo a freeze (board goes live again; plan doc untouched)
//
// ⚠️ --on is the "make it live" action. Richard's call only.
import { db, readConfig, tally, openLeagues, fmtPT } from './_banana-race-lib.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const after = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const iso = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) throw new Error(`bad date ${v}`); return d.toISOString(); };

const ref = db.collection('system_config').doc('bananaRace');
const cur = await readConfig();
console.log('current:', JSON.stringify(cur, null, 1));

const patch = {};
if (has('--on')) { patch.enabled = true; if (!cur.launchAtIso) patch.launchAtIso = new Date().toISOString(); }
if (has('--off')) patch.enabled = false;
if (after('--start')) patch.startAtIso = iso(after('--start'));
if (after('--end')) patch.endAtIso = iso(after('--end'));
if (after('--draft')) patch.draftAtIso = iso(after('--draft'));
if (after('--topn')) patch.topN = Number(after('--topn'));
if (has('--unfreeze')) patch.frozen = false;
if (Object.keys(patch).length) {
  patch.updatedAtIso = new Date().toISOString();
  await ref.set(patch, { merge: true });
  console.log('written:', JSON.stringify(patch, null, 1));
}

const cfg = { ...cur, ...patch };
console.log(`\nwindow ${fmtPT(cfg.startAtIso)} → ${fmtPT(cfg.endAtIso)} · drafts ${fmtPT(cfg.draftAtIso)} · top ${cfg.topN} · enabled=${cfg.enabled === true} frozen=${cfg.frozen === true}`);
const t = await tally(cfg);
console.log(`live tally: ${t.totals.players} players, ${t.totals.points} points; top 5: ${t.rows.slice(0, 5).map((r) => `${r.name} ${r.points}`).join(' · ') || '(nobody yet)'}`);
const leagues = await openLeagues();
const by = {};
for (const l of leagues) { by[l.tier] = by[l.tier] ?? { open: 0, leagues: 0 }; by[l.tier].open += l.open; by[l.tier].leagues++; }
console.log('open seats:', JSON.stringify(by), 'total', leagues.reduce((s, l) => s + l.open, 0));
process.exit(0);
