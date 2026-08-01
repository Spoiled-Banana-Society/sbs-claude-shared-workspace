/**
 * Backfill today's draft entries into THE ELIMINATOR's list.
 *
 * Richard 2026-07-31: "any paid or free drafts today counts". The promo opens
 * at 4pm PT, but everyone who already entered a draft earlier today should be
 * standing on the list when the first burn fires at 5pm — otherwise the opening
 * board is empty and the promo launches to nothing.
 *
 * Reads `draft_entered` activity events for the current PT day and replays them
 * through the real creditDraft() path, so the ledger, the per-day player doc and
 * the onList flag all get written by the same code the live hook uses. Nothing
 * here understands the schema on its own — that's deliberate, so a backfill can
 * never drift from production writes.
 *
 * IDEMPOTENT: creditDraft dedupes on (day, user, source, refId), so re-running
 * credits nothing twice.
 *
 * Usage:
 *   npx tsx scripts/_backfill-eliminator-today.mts           # dry run
 *   npx tsx scripts/_backfill-eliminator-today.mts --apply   # write
 */
import { getAdminFirestore } from '../lib/firebaseAdmin';
import { creditDraft } from '../lib/eliminator';
import { dayIdFor, dayFromId } from '../lib/eliminatorMath';

const APPLY = process.argv.includes('--apply');
const now = Date.now();
const dayId = dayIdFor(now);
const day = dayFromId(dayId);

// PT midnight → now. Everything entered "today" counts, including before the
// 4pm open, which is the whole point of the backfill.
const ptMidnight = new Date(
  new Date(now).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
);
ptMidnight.setHours(0, 0, 0, 0);
const sinceMs = ptMidnight.getTime()
  + (now - new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getTime());

const db = getAdminFirestore();
const snap = await db.collection('v2_activity_events')
  .where('createdAt', '>=', new Date(sinceMs))
  .get();

interface Entry { userId: string; passType: 'free' | 'paid'; refId: string; at: string }
const entries: Entry[] = [];
for (const doc of snap.docs) {
  const x = doc.data();
  if (x.type !== 'draft_entered') continue;
  const userId = String(x.userId ?? x.walletAddress ?? '').toLowerCase();
  if (!userId.startsWith('0x')) continue;
  const meta = (x.metadata ?? {}) as Record<string, unknown>;
  // paymentMethod === 'free' is how use-pass stamps a free entry; metadata
  // .passType is the same value written alongside it. Prefer the metadata.
  const passType: 'free' | 'paid' = meta.passType === 'paid'
    ? 'paid'
    : meta.passType === 'free'
      ? 'free'
      : x.paymentMethod === 'free' ? 'free' : 'paid';
  // refId must match what the live hook would have used, so a later real
  // credit for the same entry dedupes against this one.
  const leagueId = typeof meta.leagueId === 'string' ? meta.leagueId : null;
  entries.push({
    userId,
    passType,
    refId: leagueId ?? `backfill-${doc.id}`,
    at: String(x.createdAtIso ?? ''),
  });
}

const byUser = new Map<string, { free: number; paid: number }>();
for (const e of entries) {
  const cur = byUser.get(e.userId) ?? { free: 0, paid: 0 };
  cur[e.passType] += 1;
  byUser.set(e.userId, cur);
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — Eliminator day ${dayId}`);
console.log(`  list opens ${new Date(day.opensAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`);
console.log(`  burns: ${day.burnAts.length} (first ${new Date(day.burnAts[0]).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })}, final ${new Date(day.closesAt).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })})`);
console.log(`  draft_entered today: ${entries.length} across ${byUser.size} players\n`);

const preview = [...byUser.entries()]
  .map(([u, c]) => ({ u, ...c, bananas: c.free * 1 + c.paid * 2 }))
  .sort((a, b) => b.bananas - a.bananas);
for (const p of preview.slice(0, 15)) {
  console.log(`   ${p.u.slice(0, 10)}…  free=${p.free} paid=${p.paid}  → 🍌 ${p.bananas}`);
}
if (preview.length > 15) console.log(`   … and ${preview.length - 15} more`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  process.exit(0);
}

let credited = 0, skipped = 0, failed = 0;
for (const e of entries) {
  try {
    const res = await creditDraft({ userId: e.userId, draftId: e.refId, passType: e.passType });
    if (res.credited) credited += 1; else skipped += 1;
  } catch (err) {
    failed += 1;
    console.error('FAIL', e.userId, String(err).slice(0, 120));
  }
}
console.log(`\ndone: credited=${credited} skipped(dupe)=${skipped} failed=${failed}`);
console.log(`${byUser.size} players should now be on the list for ${dayId}.`);
process.exit(failed > 0 ? 1 : 0);
