/**
 * ATB round-4 carryover heal (Boris 2026-08-25): slow drafts entered in
 * round-2/3 era revealed AFTER the 8/21 round-4 reset and credited slots
 * into the fresh race (Fantasy Couch 2/10 with zero round-4 drafts).
 * Recompute every racer's TRUE round-4 lap: paid draft_filled since the
 * round started AND already revealed (in their seen ledger) → slot from the
 * draft's draftOrder index. Everything else is carryover — cleared.
 * Also stamps roundStartedAt on the state doc for the code-side gate.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const ROUND_START_ISO = '2026-08-21T01:16:50.330Z';
const API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const orderCache = new Map();
async function slotFor(draftId, wallet) {
  if (!orderCache.has(draftId)) {
    try {
      const r = await fetch(`${API}/draft/${draftId}/state/info`);
      const j = r.ok ? await r.json() : null;
      orderCache.set(draftId, Array.isArray(j?.draftOrder) ? j.draftOrder : null);
    } catch { orderCache.set(draftId, null); }
  }
  const order = orderCache.get(draftId);
  if (!order) return null;
  const idx = order.findIndex((o) => String(o.ownerId).toLowerCase() === wallet.toLowerCase());
  return idx >= 0 ? idx + 1 : null;
}

const snap = await db.collectionGroup('promos').get();
let healed = 0, unchanged = 0;
for (const d of snap.docs) {
  if (d.id !== 'around-the-banana') continue;
  const x = d.data();
  const cur = (x.modalContent?.atbSlotsHit ?? []).slice().sort((a, b) => a - b);
  if (cur.length === 0 && !(Number(x.progressCurrent) > 0)) continue;
  const wallet = d.ref.parent.parent.id;
  const seen = new Set((x.modalContent?.atbSeenDraftIds ?? []).map(String));
  const ev = await db.collection('v2_activity_events').where('walletAddress', '==', wallet).get();
  const fills = ev.docs.map(e => e.data())
    .filter(r => r.type === 'draft_filled' && r.metadata?.passType === 'paid'
      && String(r.createdAtIso) >= ROUND_START_ISO && seen.has(String(r.metadata?.draftId)));
  const trueSlots = new Set();
  for (const f of fills) {
    const s = await slotFor(String(f.metadata.draftId), wallet);
    if (s) trueSlots.add(s);
  }
  const next = [...trueSlots].sort((a, b) => a - b);
  if (JSON.stringify(next) === JSON.stringify(cur)) { unchanged++; continue; }
  console.log(`${wallet.slice(0, 10)}… ${JSON.stringify(cur)} → ${JSON.stringify(next)}`);
  if (APPLY) {
    await d.ref.update({
      progressCurrent: next.length,
      'modalContent.atbSlotsHit': next,
      ...(next.length === 0 ? {
        'modalContent.atbCompletedAt': admin.firestore.FieldValue.delete(),
        'modalContent.atbCompletedDraftName': admin.firestore.FieldValue.delete(),
      } : {}),
    });
  }
  healed++;
}
console.log(`${APPLY ? 'HEALED' : 'DRY RUN'}: changed=${healed} unchanged=${unchanged}`);
if (APPLY) {
  await db.collection('around_the_banana').doc('state').set({ roundStartedAt: ROUND_START_ISO }, { merge: true });
  console.log('roundStartedAt stamped');
}
