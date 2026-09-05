#!/usr/bin/env node
// BANANA RACE — the 6 PM PT Tuesday SEATING. Executes banana_race/plan.
// Dry-run by default (prints every call it would make). Re-runnable: each
// assignment flips `done` in the plan doc after it lands, so a crash mid-way
// picks up where it stopped.
//
//   node scripts/_banana-race-seat.mjs            # dry run
//   node scripts/_banana-race-seat.mjs --commit   # do it (reads the seat key from ~/Downloads/banana-race-seatkey.txt)
//   node scripts/_banana-race-seat.mjs --commit --only-merges     # step 1 only
//   node scripts/_banana-race-seat.mjs --commit --no-fast         # leave leagues on the slow clock (not tonight's plan)
//
// Order (so every league starts within the same minute):
//   1. merges — remove each moved seat from its old league (roarstone runbook,
//      scripts/_move-roarstone-jackhof.mjs) then POST /api/race/seat with the
//      member's existing pass tokenId into the target round
//   2. DraftType → 'fast' on every league that will fill tonight
//   3. pass A: every planned seat EXCEPT the last open seat of each league
//   4. pass B: the last seat of each league → Go fills → draft starts (fast)
import { readFileSync } from 'node:fs';
import { db, rtdb, readConfig, SITE, TIERS, TIER_LABEL, fmtPT } from './_banana-race-lib.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const ONLY_MERGES = args.includes('--only-merges');
const FAST = !args.includes('--no-fast');
const log = (...a) => console.log(...a);

const cfg = await readConfig();
if (!cfg.enabled || !cfg.frozen) { console.error('ABORT: race must be enabled AND frozen (run _banana-race-freeze.mjs --commit first)'); process.exit(1); }
const planRef = db.collection('banana_race').doc('plan');
const plan = (await planRef.get()).data();
if (!plan) { console.error('ABORT: no plan doc'); process.exit(1); }
if (Date.parse(plan.validUntilIso) < Date.now()) { console.error('ABORT: plan expired — re-run the freeze with --force'); process.exit(1); }
let seatKey = '';
if (COMMIT) {
  try { seatKey = readFileSync(`${process.env.HOME}/Downloads/banana-race-seatkey.txt`, 'utf8').trim(); } catch { console.error('ABORT: ~/Downloads/banana-race-seatkey.txt missing'); process.exit(1); }
}
log(`=== BANANA RACE SEATING ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} · plan ${plan.createdAtIso} · drafts ${fmtPT(cfg.draftAtIso)} · fast=${FAST} ===`);
log(`${plan.merges.length} merges · ${plan.assignments.length} assignments (${plan.assignments.filter((a) => a.done).length} already done)`);

async function seatCall(body) {
  if (!COMMIT) { log(`   would POST /api/race/seat ${JSON.stringify(body)}`); return { ok: true, dry: true }; }
  const r = await fetch(`${SITE}/api/race/seat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seatKey}` }, body: JSON.stringify(body),
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch { /* raw */ }
  if (!r.ok) throw new Error(`seat ${r.status}: ${text.slice(0, 300)}`);
  log(`   ✓ ${body.wallet.slice(0, 8)} → ${j.draftId ?? '?'} ${j.numPlayers ?? '?'}/10 token ${j.tokenId}${j.merged ? ' (merged)' : ''}`);
  return j;
}

// ── 1. merges ───────────────────────────────────────────────────────────────
for (const [mi, m] of plan.merges.entries()) {
  if (m.done) { log(`merge ${mi}: already done`); continue; }
  log(`\nmerge ${mi}: ${TIER_LABEL[m.tier]} round ${m.from.roundId} (${m.from.draftId ?? 'no league'}) → round ${m.into.roundId} (${m.into.draftId})`);
  for (const mem of m.members) {
    const w = mem.wallet;
    log(`  ${w.slice(0, 8)} pass ${mem.tokenId ?? '(legacy, no NFT)'}`);
    if (COMMIT) {
      // a. queue: drop from the old round
      await db.runTransaction(async (tx) => {
        const ref = db.collection('v2_queues').doc(m.tier);
        const q = (await tx.get(ref)).data();
        const r = (q.rounds ?? []).find((x) => x.roundId === m.from.roundId);
        if (!r) throw new Error(`round ${m.from.roundId} vanished`);
        r.members = (r.members ?? []).filter((x) => String(x.wallet).toLowerCase() !== w || (mem.tokenId && String(x.tokenId) !== mem.tokenId));
        tx.set(ref, q);
      });
      // b. old Go league: drop the seat + its docs (never touch a started draft)
      if (m.from.draftId) {
        const lref = db.collection('drafts').doc(m.from.draftId);
        if ((await lref.collection('state').doc('info').get()).exists) throw new Error(`ABORT: ${m.from.draftId} has a draft state — started`);
        let seatTok = null;
        await db.runTransaction(async (tx) => {
          const l = (await tx.get(lref)).data();
          const seat = (l.CurrentUsers ?? []).find((u) => String(u.OwnerId).toLowerCase() === w);
          seatTok = seat?.TokenId ?? null;
          l.CurrentUsers = (l.CurrentUsers ?? []).filter((u) => String(u.OwnerId).toLowerCase() !== w);
          l.NumPlayers = l.CurrentUsers.length;
          tx.set(lref, l);
        });
        if (seatTok) {
          for (const ref of [
            db.collection('draftTokens').doc(seatTok),
            db.collection('draftTokenMetadata').doc(seatTok),
            db.collection('owners').doc(w).collection('usedDraftTokens').doc(seatTok),
            db.collection('owners').doc(w).collection('validDraftTokens').doc(seatTok),
            lref.collection('cards').doc(seatTok),
          ]) await ref.delete().catch(() => {});
          // the NFT pass itself goes back to spendable so the join can consume it again
          if (mem.tokenId) await db.collection('owners').doc(w).collection('validDraftTokens').doc(mem.tokenId).set({ Level: TIER_LABEL[m.tier] === 'HOF' ? 'HOF' : TIER_LABEL[m.tier] }, { merge: true });
        }
        const after = (await lref.get()).data();
        await rtdb.ref(`drafts/${m.from.draftId}`).update({ numPlayers: after.NumPlayers });
        log(`     removed from ${m.from.draftId} (now ${after.NumPlayers}/10)`);
      }
    }
    // c. into the target round + Go seat (no mint: existing pass)
    await seatCall({ wallet: w, tier: m.tier, roundId: m.into.roundId, tokenId: mem.tokenId ?? undefined, fast: FAST, reason: `merge-r${m.from.roundId}` });
  }
  if (COMMIT) {
    // the emptied round: close it so nothing lands there later
    await db.runTransaction(async (tx) => {
      const ref = db.collection('v2_queues').doc(m.tier);
      const q = (await tx.get(ref)).data();
      const r = (q.rounds ?? []).find((x) => x.roundId === m.from.roundId);
      if (r && (r.members ?? []).length === 0) { r.status = 'cancelled'; r.reservedForRace = false; r.mergedInto = m.into.roundId; }
      tx.set(ref, q);
    });
    plan.merges[mi].done = true;
    await planRef.update({ merges: plan.merges });
  }
}
if (ONLY_MERGES) { log('\n--only-merges: stopping here.'); process.exit(0); }

// ── 2. fast clock on every league that fills tonight ────────────────────────
const targets = plan.leagues.filter((l) => l.roundId !== null && l.draftId);
if (FAST) {
  log(`\nDraftType → fast on ${targets.length} leagues: ${targets.map((l) => l.draftId).join(', ')}`);
  if (COMMIT) for (const l of targets) await db.collection('drafts').doc(l.draftId).set({ DraftType: 'fast' }, { merge: true });
}

// ── 3/4. seats: pass A (all but last per league), pass B (last) ─────────────
const groups = new Map();
for (const a of plan.assignments) {
  const k = `${a.tier}|${a.roundId ?? a.newKey}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(a);
}
const newRounds = {}; // newKey → roundId once created
async function doSeat(a, idx) {
  if (a.done) return;
  const body = { wallet: a.wallet, tier: a.tier, fast: FAST, reason: a.guaranteed ? `top${plan.topN}` : 'draw' };
  if (a.roundId !== null) body.roundId = a.roundId;
  else if (newRounds[a.newKey] !== undefined) body.roundId = newRounds[a.newKey];
  const res = await seatCall(body);
  if (a.newKey && res.roundId !== undefined) newRounds[a.newKey] = res.roundId;
  if (COMMIT) {
    plan.assignments[idx].done = true;
    plan.assignments[idx].result = { draftId: res.draftId ?? null, roundId: res.roundId ?? null, tokenId: res.tokenId ?? null, numPlayers: res.numPlayers ?? null };
    await planRef.update({ assignments: plan.assignments });
  }
}
const failures = [];
log('\nPASS A (all but the last seat of each league):');
for (const [k, list] of groups) {
  log(` ${k}:`);
  for (const a of list.slice(0, -1)) {
    try { await doSeat(a, plan.assignments.indexOf(a)); } catch (e) { failures.push({ a, err: String(e.message) }); log(`   ✗ ${a.wallet.slice(0, 8)}: ${e.message}`); }
  }
}
log('\nPASS B (the seat that fills each league → draft starts):');
for (const [k, list] of groups) {
  const a = list[list.length - 1];
  log(` ${k}:`);
  try { await doSeat(a, plan.assignments.indexOf(a)); } catch (e) { failures.push({ a, err: String(e.message) }); log(`   ✗ ${a.wallet.slice(0, 8)}: ${e.message}`); }
}
if (COMMIT) {
  // release reservations (everything is seated or logged)
  for (const tier of TIERS) {
    await db.runTransaction(async (tx) => {
      const ref = db.collection('v2_queues').doc(tier);
      const q = (await tx.get(ref)).data();
      for (const r of q.rounds ?? []) if (r.reservedForRace) r.reservedForRace = false;
      tx.set(ref, q);
    });
  }
}
log(`\nDONE. failures: ${failures.length}`);
for (const f of failures) log(`  ${f.a.name} ${f.a.wallet} ${TIER_LABEL[f.a.tier]} r${f.a.roundId ?? f.a.newKey}: ${f.err}`);
if (failures.length) log('Re-run the same command — done seats are skipped, failed ones retry.');
process.exit(failures.length ? 1 : 0);
