/**
 * Backfill packs for drafts that FILLED today, before THE DROP went live.
 *
 * Without this the first night opens nearly empty: packs are awarded from the
 * draft-filled webhook, so only drafts that fill AFTER the code ships earn
 * anything. Richard's call (2026-08-02) is that today's fills should count.
 *
 * ⚠️ v2 — the first version read `draft_filled` ACTIVITY EVENTS and was wrong.
 * app/api/notifications/draft-filled/route.ts only logs that event when
 * `passType === 'paid'` (see the `if (passType !== 'paid') return` guard), so
 * FREE fills emit nothing at all. The v1 backfill therefore awarded zero packs
 * for every free draft that filled — AeroSpace drafted 6 times on free passes
 * and the backfill couldn't see one of them (Richard caught it 2026-08-02).
 *
 * This version reads the same thing the live hook does: the league roster.
 *   1. `draft_entered` events in the window → the set of leagues touched today
 *   2. `drafts/{leagueId}` → filled when CurrentUsers.length >= MaxPlayers
 *   3. every OwnerId on a filled roster → resolveDraftPassType → award
 *
 * Using the roster rather than the entry events also gets leavers right: a
 * player who entered and left isn't in CurrentUsers, so they earn nothing,
 * which is exactly the anti-farming rule the live path enforces.
 *
 * IDEMPOTENT: awardPacksForFill dedupes on (night, user, draftId), so
 * re-running awards nothing twice — safe to run after the v1 pass.
 *
 * ⚠️ Refuses to run once the night has LOCKED — prizes are assigned at 8pm and
 * a pack added afterward would either be prize-less or force a re-draw.
 *
 * Usage:
 *   npx tsx scripts/_backfill-drop-packs.mts           # dry run
 *   npx tsx scripts/_backfill-drop-packs.mts --apply   # write
 */
import { getAdminFirestore } from '../lib/firebaseAdmin';
import { awardPacksForFill } from '../lib/drop';
import { nightFor } from '../lib/dropMath';
import { resolveDraftPassType } from '../lib/db-firestore';

const APPLY = process.argv.includes('--apply');
const now = Date.now();
const night = nightFor(now);

const db = getAdminFirestore();

const nightDoc = (await db.collection('drop_nights').doc(night.nightId).get()).data() as
  { status?: string } | undefined;
if (nightDoc && nightDoc.status !== 'earning') {
  console.error(`night ${night.nightId} is already ${nightDoc.status} — refusing to add packs.`);
  process.exit(1);
}

// The window this night accepts: from the previous 8pm up to now.
const windowStart = night.locksAt - 24 * 3600_000;
const snap = await db.collection('v2_activity_events')
  .where('createdAt', '>=', new Date(windowStart))
  .get();

const leagueIds = new Set<string>();
for (const doc of snap.docs) {
  const x = doc.data() as Record<string, unknown>;
  if (x.type !== 'draft_entered' && x.type !== 'draft_filled') continue;
  const meta = (x.metadata ?? {}) as Record<string, unknown>;
  const id = String(meta.leagueId ?? meta.draftId ?? '');
  if (id) leagueIds.add(id);
}

// House bots must never hold a pack — they can't claim a seat (no private key).
const botIds = new Set(
  (await db.collection('botWallets').listDocuments()).map((r) => r.id.toLowerCase()),
);

interface Fill { userId: string; draftId: string; passType: 'free' | 'paid' }
const fills: Fill[] = [];
let filledLeagues = 0, unfilledLeagues = 0, botsSkipped = 0;

for (const leagueId of leagueIds) {
  const d = (await db.collection('drafts').doc(leagueId).get()).data() as
    { CurrentUsers?: Array<{ OwnerId?: string }>; MaxPlayers?: number } | undefined;
  if (!d) { unfilledLeagues++; continue; }
  const roster = Array.isArray(d.CurrentUsers) ? d.CurrentUsers : [];
  const max = Number(d.MaxPlayers ?? 10);
  if (roster.length < max) { unfilledLeagues++; continue; }
  filledLeagues++;

  for (const seat of roster) {
    const userId = String(seat.OwnerId ?? '').toLowerCase();
    if (!userId.startsWith('0x')) continue;
    if (botIds.has(userId)) { botsSkipped++; continue; }
    // Same authoritative lookup the live hook uses — never trust the event's
    // passType, which can be stale if the seat was refunded and retaken.
    const passType = await resolveDraftPassType(userId, leagueId).catch(() => null);
    fills.push({ userId, draftId: leagueId, passType: passType === 'paid' ? 'paid' : 'free' });
  }
}

const byUser = new Map<string, { free: number; paid: number }>();
for (const f of fills) {
  const cur = byUser.get(f.userId) ?? { free: 0, paid: 0 };
  cur[f.passType] += 1;
  byUser.set(f.userId, cur);
}

const pt = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — drop night ${night.nightId}`);
console.log(`  window     ${pt(windowStart)} → now`);
console.log(`  locks at   ${pt(night.locksAt)} PT`);
console.log(`  leagues     ${leagueIds.size} touched → ${filledLeagues} FILLED, ${unfilledLeagues} not`);
console.log(`  bot seats skipped: ${botsSkipped}`);
console.log(`  fills found: ${fills.length} across ${byUser.size} players\n`);

const preview = [...byUser.entries()]
  .map(([u, c]) => ({ u, ...c, packs: c.paid * 2 + c.free }))
  .sort((a, b) => b.packs - a.packs);
for (const p of preview.slice(0, 25)) {
  console.log(`   ${p.u.slice(0, 10)}…  paid=${p.paid} free=${p.free}  → ${p.packs} packs`);
}
if (preview.length > 25) console.log(`   … and ${preview.length - 25} more`);
console.log(`\n  TOTAL PACKS: ${preview.reduce((s, p) => s + p.packs, 0)}`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  process.exit(0);
}

let awarded = 0, skipped = 0, failed = 0;
for (const f of fills) {
  try {
    const res = await awardPacksForFill({ userId: f.userId, draftId: f.draftId, passType: f.passType });
    if (res.awarded > 0) awarded += res.awarded; else skipped += 1;
  } catch (err) {
    failed += 1;
    console.error('FAIL', f.userId, f.draftId, String(err).slice(0, 120));
  }
}
console.log(`\ndone: packs=${awarded} skipped(dupe/bot/locked)=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
