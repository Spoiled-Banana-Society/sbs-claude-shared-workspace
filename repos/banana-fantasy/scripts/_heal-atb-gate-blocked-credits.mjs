/**
 * Re-credit ATB slots the fail-closed gate race blocked (2026-08-25,
 * 19:31–23:00 UTC). For each PAID fill in the window whose draftId is not in
 * the user's seen ledger: slot = draftOrder index + 1, add slot + ledger +
 * progress. Mirrors recordAroundTheBanana's doc shape; skips users with no
 * ATB promo doc (bots).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const FROM = '2026-08-25T19:31:00Z';
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

const ev = await db.collection('v2_activity_events').where('type', '==', 'draft_filled').get();
const fills = ev.docs.map(d => d.data())
  .filter(x => x.metadata?.passType === 'paid' && String(x.createdAtIso) >= FROM);
console.log('paid fills in blocked window:', fills.length);
let credited = 0, alreadySeen = 0, noDoc = 0, noSlot = 0;
for (const f of fills) {
  const w = String(f.walletAddress);
  const ref = db.collection('v2_users').doc(w).collection('promos').doc('around-the-banana');
  const p = await ref.get();
  if (!p.exists) { noDoc++; continue; }
  const x = p.data();
  const seen = (x.modalContent?.atbSeenDraftIds ?? []).map(String);
  const draftId = String(f.metadata.draftId);
  if (seen.includes(draftId)) { alreadySeen++; continue; }
  const slot = await slotFor(draftId, w);
  if (!slot) { noSlot++; console.log('  no slot resolvable:', draftId, w.slice(0, 10)); continue; }
  const slots = new Set(x.modalContent?.atbSlotsHit ?? []);
  slots.add(slot);
  const sorted = [...slots].sort((a, b) => a - b);
  console.log(`credit ${f.username ?? w.slice(0, 10)} ${draftId} slot ${slot} → ${JSON.stringify(sorted)}`);
  if (APPLY) {
    await ref.update({
      progressCurrent: sorted.length,
      updatedAt: new Date().toISOString(),
      'modalContent.atbSlotsHit': sorted,
      'modalContent.atbSeenDraftIds': [...seen, draftId].slice(-40),
    });
  }
  credited++;
}
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: credited=${credited} alreadySeen=${alreadySeen} noPromoDoc(bots)=${noDoc} noSlot=${noSlot}`);
