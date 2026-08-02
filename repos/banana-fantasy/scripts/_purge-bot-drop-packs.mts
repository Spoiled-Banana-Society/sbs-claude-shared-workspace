/**
 * ⚠️ ONE-SHOT — remove house-bot packs from tonight's DROP pool.
 *
 * The Go engine posts EVERY seat in a filled league to the draft-filled
 * webhook, bots included, and lib/drop.ts had no bot guard until 2026-08-02 —
 * so a house bot accumulated packs on the live path and could have been dealt
 * the JACKHOF seat, which it can never claim (bots hold no private key).
 * The guard is now in awardPacksForFill; this clears what already landed.
 *
 * Deletes the bot's pack docs AND its dropLedger entries (so the dedupe key
 * doesn't resurrect them), then rewrites the night's packCount from the real
 * pack docs. Safe to re-run: it's a no-op once no bot holds a pack.
 */
import { getAdminFirestore } from '../lib/firebaseAdmin';
import { nightFor } from '../lib/dropMath';

const APPLY = process.argv.includes('--apply');
const db = getAdminFirestore();
const night = nightFor(Date.now());

const st = (await db.collection('drop_nights').doc(night.nightId).get()).data() as { status?: string } | undefined;
if (st && st.status !== 'earning') { console.error(`night is ${st.status} — refusing.`); process.exit(1); }

const bots = new Set((await db.collection('botWallets').listDocuments()).map((r) => r.id.toLowerCase()));
const packsCol = db.collection('drop_nights').doc(night.nightId).collection('packs');
const all = await packsCol.get();

const botPacks = all.docs.filter((d) => bots.has(String((d.data() as { userId?: string }).userId ?? '').toLowerCase()));
const holders = new Set(botPacks.map((d) => String((d.data() as { userId?: string }).userId).toLowerCase()));

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — night ${night.nightId}`);
console.log(`  packs total ${all.size}, bot packs ${botPacks.length} across ${holders.size} bot wallet(s)`);
for (const h of holders) console.log(`   BOT ${h}`);
if (!APPLY) { console.log('\nDry run — nothing written.'); process.exit(0); }

for (const d of botPacks) await d.ref.delete();
for (const h of holders) {
  const led = await db.collection('v2_users').doc(h).collection('dropLedger').get();
  for (const d of led.docs) await d.ref.delete();
}
const remaining = (await packsCol.get()).size;
await db.collection('drop_nights').doc(night.nightId).set({ packCount: remaining }, { merge: true });
console.log(`done: removed ${botPacks.length} bot packs — packCount now ${remaining}`);
