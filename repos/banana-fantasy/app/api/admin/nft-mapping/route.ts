import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

const COLLECTION = 'nft_league_map';

/**
 * GET /api/admin/nft-mapping
 *
 * Lists every tokenId → leagueId mapping. Admin only.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) return json({ mappings: [] });

    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).get();
    const mappings = snap.docs.map((d) => ({
      tokenId: d.id,
      leagueId: d.get('leagueId') as string | null,
      ownerAtMap: d.get('ownerAtMap') as string | null,
      mappedAt: d.get('mappedAt') as number | null,
      mappedBy: d.get('mappedBy') as string | null,
    }));
    return json({ mappings });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/nft-mapping] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * POST /api/admin/nft-mapping
 *
 * Body: { tokenId, leagueId, ownerAtMap? }
 * Upserts a tokenId → leagueId mapping. Admin only.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const admin = await requireAdmin(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const body = await req.json().catch(() => ({}));
    const tokenId = String(body?.tokenId ?? '').trim();
    const leagueId = String(body?.leagueId ?? '').trim();
    const ownerAtMap = body?.ownerAtMap ? String(body.ownerAtMap).toLowerCase() : null;

    if (!/^\d+$/.test(tokenId)) return jsonError('tokenId must be a positive integer', 400);
    if (!leagueId) return jsonError('leagueId required', 400);

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(tokenId).set(
      {
        tokenId,
        leagueId,
        ownerAtMap,
        mappedAt: Date.now(),
        mappedBy: admin.walletAddress ?? admin.userId,
      },
      { merge: true },
    );

    return json({ ok: true, tokenId, leagueId, ownerAtMap });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/nft-mapping] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * DELETE /api/admin/nft-mapping?tokenId=...
 *
 * Removes a mapping. Admin only.
 */
export async function DELETE(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const url = new URL(req.url);
    const tokenId = url.searchParams.get('tokenId');
    if (!tokenId || !/^\d+$/.test(tokenId)) return jsonError('Invalid tokenId', 400);

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(tokenId).delete();
    return json({ ok: true, tokenId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/nft-mapping] DELETE failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
