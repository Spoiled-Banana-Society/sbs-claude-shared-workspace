export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/bots  — STAGING ONLY, admin-gated.
 *
 * The bot registry: every house bot wallet + the token(s) minted to it. This is
 * the list to EXCLUDE from prizes/standings when playoffs/payouts are built
 * (bots must never win — their wins flow to real cards). Until that scoring
 * system exists, this is the deliverable: the exact wallets + token ids that are
 * bots.
 */
const BOT_COLLECTION = 'botWallets';

export async function GET(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }
  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const db = getAdminFirestore();
    const snap = await db.collection(BOT_COLLECTION).where('isBot', '==', true).get();
    const bots = snap.docs.map((d) => {
      const x = d.data() as { address?: string; tokenIds?: string[]; passType?: string; mintTxHash?: string; createdAt?: number };
      return {
        address: x.address ?? d.id,
        tokenIds: x.tokenIds ?? [],
        passType: x.passType ?? 'free',
        mintTxHash: x.mintTxHash ?? null,
        createdAt: x.createdAt ?? null,
      };
    });

    const allTokenIds = bots.flatMap((b) => b.tokenIds);
    return json({
      success: true,
      count: bots.length,
      botWallets: bots.map((b) => b.address),
      botTokenIds: allTokenIds,
      bots,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.list.unhandled', { route: '/api/admin/bots', err });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
