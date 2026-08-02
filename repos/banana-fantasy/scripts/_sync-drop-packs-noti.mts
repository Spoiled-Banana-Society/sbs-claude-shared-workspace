/**
 * ⚠️ ONE-SHOT — reconcile the "you have N packs" bell with the CORRECTED pool.
 *
 * The first packs blast went out after a backfill that could only see PAID
 * fills (the draft_filled activity event is paid-only), so it notified 6
 * players when 21 actually held packs, and understated the counts of those 6.
 *
 * For a wallet that already has the bell: EDIT it in place — same doc id, so
 * no second notification lands and a read one stays read. Richard's standing
 * rule on a wrong bell is "don't re-send, just edit".
 * For a wallet that doesn't: CREATE it unread.
 *
 * Usage: npx tsx scripts/_sync-drop-packs-noti.mts [--apply]
 */
import { getAdminFirestore } from '../lib/firebaseAdmin';
import { nightFor } from '../lib/dropMath';
import { FieldValue } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const db = getAdminFirestore();
const night = nightFor(Date.now());

const packs = await db.collection('drop_nights').doc(night.nightId).collection('packs').get();
const by = new Map<string, number>();
for (const d of packs.docs) {
  const u = String((d.data() as { userId?: string }).userId ?? '').toLowerCase();
  if (u.startsWith('0x')) by.set(u, (by.get(u) ?? 0) + 1);
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — night ${night.nightId}: ${packs.size} packs / ${by.size} holders`);
let created = 0, edited = 0, same = 0, failed = 0;

for (const [wallet, n] of by) {
  const docId = `${wallet}__drop-packs-${night.nightId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  const ref = db.collection('marketplace_notifications').doc(docId);
  const cur = await ref.get();
  const body = {
    wallet,
    type: 'promo',
    icon: '🌙',
    title: `🌙 You have ${n} pack${n === 1 ? '' : 's'} waiting`,
    message: `Your drafts today earned ${n} sealed pack${n === 1 ? '' : 's'} for tonight's Drop. They open at 8:00 PM PT — 1 JackHOF seat, 1 HOF seat and 15 free spins go out every night. Tap to see your stack.`,
    link: '/drop',
  };
  if (cur.exists) {
    if ((cur.data() as { title?: string }).title === body.title) { same++; continue; }
    edited++;
    if (APPLY) await ref.set(body, { merge: true }).catch(() => { failed++; });
  } else {
    created++;
    if (APPLY) {
      await ref.set({ ...body, read: false, createdAt: FieldValue.serverTimestamp() })
        .catch(() => { failed++; });
    }
  }
}
console.log(`done: created=${created} edited=${edited} unchanged=${same} failed=${failed}`);
