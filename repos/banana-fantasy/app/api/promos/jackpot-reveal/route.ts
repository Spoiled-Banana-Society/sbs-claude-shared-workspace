import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from 'crypto';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

// GET /api/promos/jackpot-reveal?draftId=X
//
// Returns the 10 drafter usernames in their draft-order positions plus
// the deterministic winner index (sha256(draftId) mod 10 — same algo as
// recordJackpotHit). Used by the Jackpot Hit promo modal to label the
// winner-picker animation tiles with real names.

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const url = new URL(req.url);
    const draftId = url.searchParams.get('draftId');
    if (!draftId) throw new ApiError(400, 'draftId required');

    // v2 (2026-06-10): if a recorded DRAW exists for this draft, return it —
    // paid-entrant labels + the actual winner + seed basis, so the modal
    // replays the exact draw (provably fair) instead of generic slots.
    if (isFirestoreConfigured()) {
      try {
        const drawSnap = await getAdminFirestore().collection('jackpot_draws').doc(draftId).get();
        const d = drawSnap.data() as {
          pending?: boolean;
          eligible?: { wallet: string; name: string; idx: number; slot?: number }[];
          winnerWallet?: string | null;
          winnerName?: string | null;
          reward?: number;
          seedBasis?: string;
          vrfPeriod?: number | null;
          saltHash?: string | null;
          receiptTxHash?: string | null;
        } | undefined;
        if (drawSnap.exists && d && d.pending === false && Array.isArray(d.eligible) && d.eligible.length > 0) {
          const labels = d.eligible.map((e) => e.name || `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`);
          // Rich entries: real draft slot + wallet so the client can
          // live-resolve names/pfps (default-or-edited) and label tiles
          // with the slots people actually had in the room.
          const entries = d.eligible.map((e, i) => ({
            wallet: e.wallet,
            name: e.name || `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`,
            slot: typeof e.slot === 'number' && e.slot > 0 ? e.slot : i + 1,
          }));
          const winnerIdx = d.eligible.findIndex((e) => e.wallet === d.winnerWallet);
          return json({
            labels,
            entries,
            draw: {
              seed: `jp-draw:${draftId}`,
              winnerIdx: winnerIdx >= 0 ? winnerIdx : null,
              winnerName: d.winnerName ?? null,
              reward: d.reward ?? 0,
              seedBasis: d.seedBasis ?? '',
              vrfPeriod: d.vrfPeriod ?? null,
              saltHash: d.saltHash ?? null,
              receiptTxHash: d.receiptTxHash ?? null,
            },
          });
        }
      } catch { /* fall through to legacy labels */ }
    }

    const apiBase = (
      process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
      process.env.STAGING_DRAFTS_API_URL ||
      'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
    ).replace(/\/$/, '');

    const res = await fetch(`${apiBase}/draft/${encodeURIComponent(draftId)}/state/info`);
    if (!res.ok) throw new ApiError(404, 'draft not found');
    const data = (await res.json()) as { draftOrder?: { ownerId?: string }[] };
    const order = Array.isArray(data?.draftOrder) ? data.draftOrder : [];

    const ownerIds = order.slice(0, 10).map(o => (typeof o?.ownerId === 'string' ? o.ownerId.toLowerCase() : ''));

    let labels: string[] = ownerIds.map((id, i) =>
      id ? `${id.slice(0, 6)}…${id.slice(-4)}` : `Drafter #${i + 1}`,
    );

    if (isFirestoreConfigured()) {
      try {
        const db = getAdminFirestore();
        const usersCol = db.collection('users');
        const docs = await Promise.all(
          ownerIds.map(id => (id ? usersCol.doc(id).get() : Promise.resolve(null))),
        );
        labels = docs.map((snap, i) => {
          const fallback = labels[i];
          if (!snap || !snap.exists) return fallback;
          const u = snap.data() as { username?: string } | undefined;
          const username = u?.username?.trim();
          return username && !username.startsWith('User-') ? username : fallback;
        });
      } catch (err) {
        logger.warn('jackpot-reveal.username_lookup_failed', { err });
      }
    }

    const hash = crypto.createHash('sha256').update(draftId).digest();
    const winnerIdx = hash.readUInt32BE(0) % 10;

    return json({ draftId, labels, winnerIdx, ownerIds }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('jackpot-reveal.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
