#!/usr/bin/env node
// BANANA RACE — print the live board exactly as /race computes it. READ-ONLY.
//
//   node scripts/_banana-race-board.mjs           # top 40 + open leagues
//   node scripts/_banana-race-board.mjs --all     # every row
//   node scripts/_banana-race-board.mjs --csv     # also write ~/Downloads/banana-race-board-<date>.csv
import { writeFileSync } from 'node:fs';
import { readConfig, tally, openLeagues, fmtPT, TIER_LABEL } from './_banana-race-lib.mjs';

const args = new Set(process.argv.slice(2));
const cfg = await readConfig();
console.log(`Banana Race · ${fmtPT(cfg.startAtIso)} → ${fmtPT(cfg.endAtIso)} · enabled=${cfg.enabled === true} frozen=${cfg.frozen === true}\n`);
const t = await tally(cfg);
const rows = args.has('--all') ? t.rows : t.rows.slice(0, 40);
console.log('   # | pts | player                 | wallets | reached');
for (const [i, r] of rows.entries()) {
  const lock = i < cfg.topN ? '★' : ' ';
  console.log(`${lock}${String(i + 1).padStart(3)} | ${String(r.points).padStart(3)} | ${r.name.padEnd(22).slice(0, 22)} | ${r.wallets.map((w) => w.slice(0, 8)).join(',').padEnd(7)} | ${r.reachedAtIso.slice(0, 16)}`);
}
console.log(`\n${t.totals.players} players · ${t.totals.points} points · cutoff (#${cfg.topN}) = ${t.rows[cfg.topN - 1]?.points ?? 0}`);

const leagues = await openLeagues();
console.log('\nopen special leagues:');
for (const l of leagues) {
  console.log(`  ${TIER_LABEL[l.tier].padEnd(7)} round ${String(l.roundId).padStart(3)} ${String(l.draftId ?? '(no league yet)').padEnd(20)} ${l.source.padEnd(5)} ${l.members.length}/10 open=${l.open}${l.reserved ? ' RESERVED' : ''}${l.started ? ' STARTED?!' : ''}`);
}
console.log(`  total open: ${leagues.reduce((s, l) => s + l.open, 0)}`);

if (args.has('--csv')) {
  const out = `${process.env.HOME}/Downloads/banana-race-board-${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(out, ['rank,points,player,wallets,reached_at', ...t.rows.map((r, i) => `${i + 1},${r.points},"${r.name.replace(/"/g, '""')}","${r.wallets.join(' ')}",${r.reachedAtIso}`)].join('\n') + '\n');
  console.log('wrote', out);
}
process.exit(0);
