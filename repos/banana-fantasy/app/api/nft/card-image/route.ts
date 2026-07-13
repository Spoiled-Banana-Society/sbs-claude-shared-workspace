import { json, jsonError } from '@/lib/api/routeUtils';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';
import { buildOgCardUrl, type OgCardPayload } from '@/lib/nftCard';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

async function refreshOpenSea(tokenId: string): Promise<boolean> {
  if (!OPENSEA_API_KEY) return false;
  try {
    const url = `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}/refresh`;
    const res = await fetch(url, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/marketplace card-image — set a BBB4 token's metadata `Image` to the
 * obsidian card (the /api/og/team-card render) and ask OpenSea to re-fetch.
 *
 * Used for:
 *  - team reveal  → from the roster page, for the owner's own token.
 *  - pre-reveal pass → at mint, with `{ preReveal: true, passNo: <tokenId> }`.
 *
 * Writes ONLY the `Image` field (merge) so the Go-written Name/Attributes stay.
 * Best-effort: invalid/synthetic token ids are reported, never thrown.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  let body: { tokenId?: string | number } & OgCardPayload;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const tokenId = String(body.tokenId ?? '').trim();
  // BBB4 token ids are sequential integers; reject timestamp-shaped / empty ids.
  if (!/^\d+$/.test(tokenId)) {
    return jsonError('Missing or invalid tokenId', 400);
  }

  const payload: OgCardPayload = body.preReveal
    ? { preReveal: true, passNo: body.passNo ?? tokenId }
    : { tier: body.tier, passNo: body.passNo ?? tokenId, teamNo: body.teamNo ?? tokenId, leagueNo: body.leagueNo, players: body.players };

  const image = buildOgCardUrl(payload);

  try {
    const db = getAdminFirestore();
    await db.collection('draftTokenMetadata').doc(tokenId).set({ Image: image }, { merge: true });
  } catch (err) {
    logger.error('nft.card_image_write_failed', { tokenId, error: String(err) });
    return jsonError('Failed to write metadata', 500);
  }

  const refreshed = await refreshOpenSea(tokenId);
  logger.info('nft.card_image_set', { tokenId, preReveal: !!body.preReveal, refreshed });
  return json({ ok: true, tokenId, image, refreshed });
}
