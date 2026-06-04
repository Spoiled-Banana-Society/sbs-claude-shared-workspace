import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * POST /api/marketplace/refresh-draft/[draftId]
 *
 * Fired once when a draft closes. Asks OpenSea to re-fetch metadata for ALL 10
 * of the draft's freshly-generated team tokens, so the revealed roster + card
 * art shows on OpenSea (and therefore in our marketplace, which reads owned
 * NFTs from OpenSea). The token IDs come from `drafts/{draftId}/cards` (each
 * card doc id IS the BBB4 token id). OpenSea queues each refresh asynchronously.
 *
 * Idempotent + best-effort: safe to call repeatedly; non-existent/synthetic
 * staging token ids simply fail their refresh and are reported, never thrown.
 */
async function refreshToken(tokenId: string): Promise<boolean> {
  const url = `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}/refresh`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const { draftId } = params;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }
    if (!draftId) {
      return jsonError('Missing draftId', 400);
    }

    const db = getAdminFirestore();
    const cardsSnap = await db.collection('drafts').doc(draftId).collection('cards').get();

    // Each card doc id is the BBB4 token id (written by the WS server as
    // drafts/{leagueId}/cards/{CardId}). Keep numeric ids only — OpenSea's
    // refresh endpoint takes a numeric token identifier.
    const tokenIds = Array.from(
      new Set(
        cardsSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return String(data?.CardId ?? data?.cardId ?? d.id);
          })
          .filter((id) => /^\d+$/.test(id)),
      ),
    );

    if (tokenIds.length === 0) {
      logger.info('marketplace.refresh_draft_empty', { draftId });
      return json({ ok: true, draftId, refreshed: 0, total: 0, tokenIds: [] });
    }

    logger.info('marketplace.refresh_draft', { draftId, total: tokenIds.length });

    const results = await Promise.allSettled(tokenIds.map((id) => refreshToken(id)));
    const ok = (i: number) =>
      results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<boolean>).value;
    const refreshed = tokenIds.filter((_, i) => ok(i)).length;
    const failed = tokenIds.filter((_, i) => !ok(i));

    if (failed.length > 0) {
      // Partial is expected on staging (synthetic test tokens aren't on-chain).
      logger.warn('marketplace.refresh_draft_partial', {
        draftId,
        refreshed,
        total: tokenIds.length,
        failed,
      });
    } else {
      logger.info('marketplace.refresh_draft_done', { draftId, refreshed });
    }

    return json({ ok: true, draftId, refreshed, total: tokenIds.length, failed });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error(LOG_SOURCES.marketplace.REFRESH_DRAFT_FAILED, { err, draftId });
    return jsonError('Internal Server Error', 500);
  }
}
