#!/usr/bin/env node
// BANANA RACE — the 5 PM PT Tuesday FREEZE. Dry-run by default (prints the
// whole plan, writes ~/Downloads/banana-race-plan-<ts>.json, changes nothing).
//
//   node scripts/_banana-race-freeze.mjs            # dry run
//   node scripts/_banana-race-freeze.mjs --commit   # freeze + plan + reserve rounds
//   node scripts/_banana-race-freeze.mjs --commit --seed <hex>   # replay a seed (re-plan after a fix)
//   node scripts/_banana-race-freeze.mjs --window 2026-08-28T07:00:00Z 2026-09-04T07:00:00Z   # DRY RUN over any window (rehearsal)
//
// What --commit writes:
//   1. banana_race/final     { tally, seatsAtFreeze, results, frozenAtIso }  → the page serves this
//   2. system_config/bananaRace.frozen = true                             → board stops moving
//   3. banana_race/plan      { merges, assignments, seed, seatKeyHash, validUntilIso } → _banana-race-seat.mjs executes it
//   4. reservedForRace: true on every existing round the plan touches   → wheel wins can't take a planned seat between 5 and 6
// It prints the one-time SEAT KEY once (also saved to ~/Downloads/banana-race-seatkey.txt).
// It does NOT mint or seat anything — that is the 6 PM script.
//
// The plan (Richard 9/4):
//   merges  — same tier, smaller league folds into a bigger one that has room
//             and shares no person; only leagues that have not started
//   top N   — each gets a JackHOF seat; fullest JackHOF league they are not in;
//             nowhere to sit → a NEW JackHOF league is opened for them
//   draw    — every remaining open seat (incl. the new league's 9), JackHOF
//             first, then Jackpot, then HOF; each point = 1 ticket; one seat per
//             person per league, several leagues allowed; top N included; no cap
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { db, readConfig, tally, openLeagues, rng, fmtPT, TIERS, TIER_LABEL } from './_banana-race-lib.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const seedArg = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null;
const log = (...a) => console.log(...a);

const cfg = await readConfig();
if (args.includes('--window')) {
  if (COMMIT) { console.error('ABORT: --window is for rehearsal dry runs only'); process.exit(1); }
  const i = args.indexOf('--window');
  cfg.startAtIso = new Date(args[i + 1]).toISOString(); cfg.endAtIso = new Date(args[i + 2]).toISOString(); cfg.frozen = false;
}
if (!cfg.enabled && COMMIT) { console.error('ABORT: Banana Race is not enabled (system_config/bananaRace.enabled)'); process.exit(1); }
if (cfg.frozen && COMMIT && !args.includes('--force')) { console.error('ABORT: already frozen. Re-plan with --force (keeps the frozen tally, rebuilds the plan).'); process.exit(1); }

// ── 1. tally (frozen tally wins if it exists) ───────────────────────────────
let t;
const finalSnap = await db.collection('banana_race').doc('final').get();
if (cfg.frozen && finalSnap.exists && finalSnap.data().tally) {
  t = finalSnap.data().tally; log(`using FROZEN tally from ${finalSnap.data().frozenAtIso}`);
} else {
  t = await tally(cfg);
}
const topN = Math.max(1, Number(cfg.topN) || 10);
const rows = t.rows;
const byKey = new Map(rows.map((r) => [r.key, r]));
log(`\n=== BANANA RACE FREEZE ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} · window ${fmtPT(cfg.startAtIso)} → ${fmtPT(cfg.endAtIso)} ===`);
log(`${t.totals.players} players · ${t.totals.points} points · cutoff #${topN} = ${rows[topN - 1]?.points ?? 0}`);
for (const [i, r] of rows.slice(0, topN).entries()) log(`  ★ #${i + 1} ${r.name} ${r.points} (${r.seatWallet.slice(0, 8)})`);

// ── 2. leagues ──────────────────────────────────────────────────────────────
const leagues = (await openLeagues()).filter((l) => !l.started);
const started = (await openLeagues()).filter((l) => l.started);
if (started.length) log(`\n⚠️ ${started.length} filling round(s) already have a draft state — skipped: ${started.map((l) => l.draftId).join(', ')}`);
for (const l of leagues) { l.persons = new Set(l.members.map((m) => m.person)); l.assigned = []; }
const label = (l) => `${TIER_LABEL[l.tier]} r${l.roundId} ${l.draftId ?? l.newKey}`;

// ── 3. merges ───────────────────────────────────────────────────────────────
const merges = [];
for (const tier of TIERS) {
  let changed = true;
  while (changed) {
    changed = false;
    const pool = leagues.filter((l) => l.tier === tier && !l.mergedInto).sort((a, b) => a.members.length - b.members.length);
    for (const small of pool) {
      if (small.members.length === 0) continue;
      const target = pool
        .filter((big) => big !== small && big.members.length >= small.members.length && big.open >= small.members.length
          && ![...small.persons].some((p) => big.persons.has(p)))
        .sort((a, b) => b.members.length - a.members.length)[0];
      if (!target) continue;
      merges.push({ tier, from: { roundId: small.roundId, draftId: small.draftId }, into: { roundId: target.roundId, draftId: target.draftId }, members: small.members });
      for (const m of small.members) { target.members.push(m); target.persons.add(m.person); }
      target.open = 10 - target.members.length;
      small.mergedInto = target.roundId; small.members = []; small.persons = new Set(); small.open = 0;
      changed = true;
      break;
    }
  }
}
log(`\nmerges: ${merges.length}`);
for (const m of merges) log(`  ${TIER_LABEL[m.tier]} round ${m.from.roundId} (${m.from.draftId ?? 'no league'}) → round ${m.into.roundId} (${m.into.draftId}): ${m.members.map((x) => x.wallet.slice(0, 8)).join(', ')}`);

// ── 4. top N guaranteed JackHOF ─────────────────────────────────────────────
const live = () => leagues.filter((l) => !l.mergedInto);
const assignments = [];
let newCount = 0;
const seatIn = (league, row, guaranteed) => {
  league.assigned.push(row.key); league.persons.add(row.key); league.open -= 1;
  assignments.push({ key: row.key, wallet: row.seatWallet, name: row.name, points: row.points, tier: league.tier, roundId: league.roundId ?? null, draftId: league.draftId ?? null, newKey: league.newKey ?? null, guaranteed });
};
for (const row of rows.slice(0, topN)) {
  const cands = live().filter((l) => l.tier === 'jackhof' && l.open > 0 && !l.persons.has(row.key)).sort((a, b) => b.members.length + b.assigned.length - (a.members.length + a.assigned.length));
  let target = cands[0];
  if (!target) {
    newCount += 1;
    target = { tier: 'jackhof', roundId: null, draftId: null, source: 'race', newKey: `new-jackhof-${newCount}`, members: [], persons: new Set(), assigned: [], open: 10, reserved: false, started: false };
    leagues.push(target);
    log(`  ↳ ${row.name} is already in every JackHOF league → opening ${target.newKey}`);
  }
  seatIn(target, row, true);
}

// ── 5. the draw ─────────────────────────────────────────────────────────────
const seed = (seedArg ?? randomBytes(16).toString('hex')).toLowerCase();
const rand = rng(seed);
const unfilled = [];
for (const tier of TIERS) {
  for (const l of live().filter((x) => x.tier === tier).sort((a, b) => (a.roundId ?? 1e9) - (b.roundId ?? 1e9))) {
    while (l.open > 0) {
      const eligible = rows.filter((r) => r.points > 0 && !l.persons.has(r.key));
      const total = eligible.reduce((s, r) => s + r.points, 0);
      if (total === 0) { unfilled.push({ league: label(l), open: l.open }); break; }
      let pick = rand() * total;
      let winner = eligible[eligible.length - 1];
      for (const r of eligible) { pick -= r.points; if (pick < 0) { winner = r; break; } }
      seatIn(l, winner, false);
    }
  }
}

// ── 6. print ────────────────────────────────────────────────────────────────
log(`\nseed ${seed}`);
log(`assignments: ${assignments.length} (${assignments.filter((a) => a.guaranteed).length} guaranteed JackHOF, ${newCount} new league(s))`);
for (const l of live().sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || (a.roundId ?? 1e9) - (b.roundId ?? 1e9))) {
  const a = assignments.filter((x) => x.roundId === l.roundId && x.newKey === (l.newKey ?? null) && x.tier === l.tier);
  log(`  ${label(l).padEnd(34)} ${l.members.length}+${a.length} = ${l.members.length + a.length}/10${l.open > 0 ? `  ⚠️ ${l.open} UNFILLED` : ''}`);
  for (const x of a) log(`      ${x.guaranteed ? '★' : '·'} ${x.name} (${x.wallet.slice(0, 8)}) ${x.points}p`);
}
if (unfilled.length) log(`\n⚠️ UNFILLED: ${JSON.stringify(unfilled)} — not enough distinct people for these seats.`);
const perPerson = {};
for (const a of assignments) perPerson[a.name] = (perPerson[a.name] ?? 0) + 1;
log(`\nseats per person: ${Object.entries(perPerson).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${n}:${c}`).join(' ')}`);

const now = new Date().toISOString();
const results = {
  frozenAtIso: now,
  topN: rows.slice(0, topN).map((r, i) => ({ rank: i + 1, name: r.name, points: r.points })),
  draw: assignments.map((a) => ({ name: a.name, tier: a.tier, draftId: a.draftId, roundId: a.roundId ?? -1, guaranteed: a.guaranteed })),
  seatsFilled: assignments.length,
};
const plan = {
  createdAtIso: now, seed, topN, cfg: { startAtIso: cfg.startAtIso, endAtIso: cfg.endAtIso, draftAtIso: cfg.draftAtIso },
  merges, assignments: assignments.map((a) => ({ ...a, done: false })), unfilled,
  leagues: live().map((l) => ({ tier: l.tier, roundId: l.roundId, draftId: l.draftId, newKey: l.newKey ?? null, existing: l.members.length, planned: l.assigned.length })),
};
const stamp = now.replace(/[:.]/g, '-');
const planPath = `${process.env.HOME}/Downloads/banana-race-plan-${stamp}.json`;
writeFileSync(planPath, JSON.stringify({ tally: t, plan, results }, null, 2));
log(`\nplan written: ${planPath}`);

if (!COMMIT) { log('\nDRY RUN — nothing changed. Re-run with --commit at 5:00 PM PT.'); process.exit(0); }

// ── 7. commit ───────────────────────────────────────────────────────────────
const seatKey = randomBytes(24).toString('hex');
const seatKeyHash = createHash('sha256').update(seatKey).digest('hex');
const validUntilIso = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
await db.collection('banana_race').doc('final').set({ tally: t, results, seatsAtFreeze: plan.leagues, frozenAtIso: now }, { merge: true });
await db.collection('system_config').doc('bananaRace').set({ frozen: true, frozenAtIso: now, updatedAtIso: now }, { merge: true });
await db.collection('banana_race').doc('plan').set({ ...plan, seatKeyHash, validUntilIso });
for (const tier of TIERS) {
  const ids = new Set(plan.leagues.filter((l) => l.tier === tier && l.roundId !== null).map((l) => l.roundId));
  if (!ids.size) continue;
  await db.runTransaction(async (tx) => {
    const ref = db.collection('v2_queues').doc(tier);
    const q = (await tx.get(ref)).data();
    for (const r of q.rounds ?? []) if (ids.has(r.roundId)) r.reservedForRace = true;
    tx.set(ref, q);
  });
}
writeFileSync(`${process.env.HOME}/Downloads/banana-race-seatkey.txt`, seatKey + '\n', { mode: 0o600 });
log(`\nFROZEN. Reserved ${plan.leagues.filter((l) => l.roundId !== null).length} rounds. Plan valid until ${validUntilIso}.`);
log(`SEAT KEY (once): ${seatKey}   → saved to ~/Downloads/banana-race-seatkey.txt`);
log('Next: node scripts/_banana-race-bells.mjs --winners --apply, then at 6 PM node scripts/_banana-race-seat.mjs --commit');
process.exit(0);
