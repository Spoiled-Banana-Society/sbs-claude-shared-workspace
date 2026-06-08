// Prize overlay layer.
//
// The Go API is the source of truth for "wins" (`/owner/{userId}/prizes`).
// We can't mutate Go-API records, so to make wins claimable / paid we
// keep two Firestore-backed layers on top:
//
//   1. synthetic_prizes/{prizeId}
//      Admin-granted test prizes that look identical to Go-API wins
//      to the frontend. Used to seed test wallets without running a
//      full draft. ID prefix `syn_` so they're cleanly distinguishable.
//
//   2. prize_overlays/{prizeId}
//      Per-prize-ID status overlay applied at read time. Lets us mark
//      a Go-API win as `processing` (during withdrawal) or `paid`
//      (after Gnosis batch confirms) without touching Go-API data.
//
// The withdraw-all flow creates a single withdrawalRequests doc with
// `prizeIds: [...]` covering every prize being settled. When admin
// flips that withdrawal to 'paid', cascading helpers in this file mark
// each referenced prize as paid (via overlay or direct update for
// synthetic prizes).

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';
import type { PrizeWin, PrizeStatus } from '@/types';

const SYNTHETIC_COLLECTION = 'synthetic_prizes';
const OVERLAY_COLLECTION = 'prize_overlays';

const SYNTHETIC_ID_PREFIX = 'syn_';

export function isSyntheticPrizeId(id: string): boolean {
  return id.startsWith(SYNTHETIC_ID_PREFIX);
}

export interface SyntheticPrize {
  id: string;             // 'syn_xxx'
  userId: string;         // canonical lowercase wallet
  amount: number;         // USD value
  contestName: string;
  status: PrizeStatus;    // 'pending' | 'processing' | 'paid' | 'forfeited'
  draftId?: string;
  createdAt: string;      // ISO
  paidAt?: string;        // ISO when status flipped to paid
  // Notes from the granting admin (optional, for audit / sanity).
  note?: string;
  grantedBy?: string;     // admin wallet address
}

export interface PrizeOverlay {
  prizeId: string;
  userId: string;
  status: 'processing' | 'paid';
  withdrawalId?: string;
  updatedAt: string;
  paidAt?: string;
}

/**
 * Create a synthetic prize for a user. Returns the new prize doc.
 * Used by the admin grant-prize tool for testing.
 */
export async function createSyntheticPrize(input: {
  userId: string;
  amount: number;
  contestName: string;
  draftId?: string;
  note?: string;
  grantedBy?: string;
}): Promise<SyntheticPrize | null> {
  if (!isFirestoreConfigured()) return null;
  const db = getAdminFirestore();
  const id = `${SYNTHETIC_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const doc: SyntheticPrize = {
    id,
    userId: input.userId.toLowerCase(),
    amount: input.amount,
    contestName: input.contestName,
    status: 'pending',
    createdAt: now,
  };
  if (input.draftId) doc.draftId = input.draftId;
  if (input.note) doc.note = input.note;
  if (input.grantedBy) doc.grantedBy = input.grantedBy.toLowerCase();
  await db.collection(SYNTHETIC_COLLECTION).doc(id).set(doc);
  return doc;
}

/**
 * Get all synthetic prizes for a user, projected as PrizeWin so the
 * /prizes history endpoint can merge them with Go-API wins without
 * needing to know they're synthetic.
 */
export async function getSyntheticPrizesForUser(userId: string): Promise<PrizeWin[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const snap = await db
    .collection(SYNTHETIC_COLLECTION)
    .where('userId', '==', userId.toLowerCase())
    .get();
  const out: PrizeWin[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as SyntheticPrize;
    out.push({
      id: data.id,
      type: 'win',
      amount: data.amount,
      contestName: data.contestName,
      status: data.status,
      createdAt: data.createdAt,
      paidDate: data.paidAt,
      draftId: data.draftId,
    });
  }
  return out;
}

/**
 * Look up status overlays for a list of prize IDs in one batch read.
 * Returns a map prizeId → overlay. Missing entries mean no overlay
 * (use the original status from Go API / synthetic record).
 *
 * Firestore in().limit(30) constraint — we chunk if the list is bigger.
 */
export async function getPrizeOverlays(prizeIds: string[]): Promise<Map<string, PrizeOverlay>> {
  const out = new Map<string, PrizeOverlay>();
  if (!isFirestoreConfigured() || prizeIds.length === 0) return out;
  const db = getAdminFirestore();
  // 'in' filter is capped at 30 values per query
  const chunks: string[][] = [];
  for (let i = 0; i < prizeIds.length; i += 30) chunks.push(prizeIds.slice(i, i + 30));
  await Promise.all(chunks.map(async (chunk) => {
    const snap = await db
      .collection(OVERLAY_COLLECTION)
      .where('prizeId', 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as PrizeOverlay;
      out.set(data.prizeId, data);
    }
  }));
  return out;
}

/**
 * Effective claim state for a prize, merged across BOTH layers:
 * Go-API prizes (status lives in prize_overlays) and synthetic prizes
 * (status lives on the synthetic_prizes doc itself). `withdrawalId` is
 * the withdrawal that claimed/settled it, when known.
 *
 * Used to guard the money path:
 *  - withdraw-all refuses to settle a prize that is already
 *    'processing' or 'paid' (double-withdrawal guard).
 *  - the admin pay route refuses to pay a withdrawal whose prizes were
 *    already 'paid' by a DIFFERENT withdrawal (double-payout backstop).
 */
export interface PrizeClaimState {
  status: string; // 'pending' | 'processing' | 'paid' | 'forfeited'
  withdrawalId?: string;
}

export async function getPrizeClaimStates(prizeIds: string[]): Promise<Map<string, PrizeClaimState>> {
  const out = new Map<string, PrizeClaimState>();
  if (!isFirestoreConfigured() || prizeIds.length === 0) return out;
  const db = getAdminFirestore();
  const overlayIds = prizeIds.filter((id) => !isSyntheticPrizeId(id));
  const synIds = prizeIds.filter((id) => isSyntheticPrizeId(id));

  // Go-API prizes: read the overlay layer (batched, chunked at 30).
  const overlays = await getPrizeOverlays(overlayIds);
  for (const [pid, ov] of overlays) {
    out.set(pid, { status: ov.status, withdrawalId: ov.withdrawalId });
  }

  // Synthetic prizes: status is on the doc itself. Small N (explicit
  // selections), so per-doc reads are fine.
  await Promise.all(synIds.map(async (pid) => {
    const snap = await db.collection(SYNTHETIC_COLLECTION).doc(pid).get();
    if (snap.exists) {
      const data = snap.data() as SyntheticPrize & { withdrawalId?: string };
      out.set(pid, { status: data.status, withdrawalId: data.withdrawalId });
    }
  }));

  return out;
}

/**
 * Apply overlays to a list of PrizeWin records. Mutates statuses to
 * reflect what the overlay says, and sets paidDate when relevant.
 * No-op for items that have no overlay.
 */
export function applyOverlaysToWins(
  wins: PrizeWin[],
  overlays: Map<string, PrizeOverlay>,
): PrizeWin[] {
  return wins.map((w) => {
    const overlay = overlays.get(w.id);
    if (!overlay) return w;
    return {
      ...w,
      status: overlay.status,
      paidDate: overlay.paidAt ?? w.paidDate,
    };
  });
}

/**
 * Mark a list of prizes as `processing` against a withdrawal. Used
 * when a withdrawal request is created so /prizes shows them as
 * in-flight rather than still pending. Idempotent — re-marking is OK.
 */
export async function markPrizesProcessing(input: {
  prizeIds: string[];
  userId: string;
  withdrawalId: string;
}): Promise<void> {
  if (!isFirestoreConfigured() || input.prizeIds.length === 0) return;
  const db = getAdminFirestore();
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const prizeId of input.prizeIds) {
    if (isSyntheticPrizeId(prizeId)) {
      // Direct update to synthetic prize doc. Stamp the claiming
      // withdrawalId so the double-payout backstop can tell which
      // withdrawal owns this synthetic prize.
      const ref = db.collection(SYNTHETIC_COLLECTION).doc(prizeId);
      batch.set(ref, { status: 'processing', withdrawalId: input.withdrawalId, updatedAt: now }, { merge: true });
    } else {
      // Overlay write for Go-API prize.
      const ref = db.collection(OVERLAY_COLLECTION).doc(prizeId);
      const overlay: PrizeOverlay = {
        prizeId,
        userId: input.userId.toLowerCase(),
        status: 'processing',
        withdrawalId: input.withdrawalId,
        updatedAt: now,
      };
      batch.set(ref, overlay, { merge: true });
    }
  }
  await batch.commit();
}

/**
 * Mark a list of prizes as `paid`. Called from the admin mark-paid
 * cascade when a withdrawal flips to 'paid'.
 */
export async function markPrizesPaid(input: {
  prizeIds: string[];
  userId: string;
  withdrawalId: string;
}): Promise<void> {
  if (!isFirestoreConfigured() || input.prizeIds.length === 0) return;
  const db = getAdminFirestore();
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const prizeId of input.prizeIds) {
    if (isSyntheticPrizeId(prizeId)) {
      const ref = db.collection(SYNTHETIC_COLLECTION).doc(prizeId);
      batch.set(
        ref,
        { status: 'paid', paidAt: now, withdrawalId: input.withdrawalId, updatedAt: now },
        { merge: true },
      );
    } else {
      const ref = db.collection(OVERLAY_COLLECTION).doc(prizeId);
      const overlay: PrizeOverlay = {
        prizeId,
        userId: input.userId.toLowerCase(),
        status: 'paid',
        withdrawalId: input.withdrawalId,
        updatedAt: now,
        paidAt: now,
      };
      batch.set(ref, overlay, { merge: true });
    }
  }
  await batch.commit();
}

/**
 * Roll back a processing overlay — used if a withdrawal is denied or
 * fails creation, so the prize goes back to pending and the user can
 * try withdrawing again.
 */
export async function clearPrizeOverlays(prizeIds: string[]): Promise<void> {
  if (!isFirestoreConfigured() || prizeIds.length === 0) return;
  const db = getAdminFirestore();
  const batch = db.batch();
  for (const prizeId of prizeIds) {
    if (isSyntheticPrizeId(prizeId)) {
      const ref = db.collection(SYNTHETIC_COLLECTION).doc(prizeId);
      batch.set(ref, { status: 'pending', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      const ref = db.collection(OVERLAY_COLLECTION).doc(prizeId);
      batch.delete(ref);
    }
  }
  await batch.commit();
}
