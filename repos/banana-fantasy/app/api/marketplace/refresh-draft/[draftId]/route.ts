import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getDraftSummary, getDraftInfo } from '@/lib/draftApi';
import { buildOgCardUrl } from '@/lib/nftCard';
import { upsertMarketplaceIndex, normalizeLevel } from '@/lib/marketplaceIndex';
import { computeAndStoreRipeness, countPaidDraftsDone } from '@/lib/db';
import type { CardPlayer, CardTier } from '@/components/draft/TeamCardObsidian';
import { ALL_POSITIONS } from '@/data/nfl-players';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

const PLAYER_META = new Map(ALL_POSITIONS.map((p) => [p.playerId, p]));

function tierFromLevel(level: string): CardTier {
  const l = (level || '').toLowerCase();
  if (l.includes('jackpot')) return 'jackpot';
  if (l.includes('hof') || l.includes('hall of fame')) return 'hof';
  return 'pro';
}

/**
 * Write the FULL-data obsidian team image for ALL of a draft's tokens at close
 * — so every team (not just ones whose owner visits their roster page) gets the
 * complete card (RB1/WR1 numbering + BYE/ADP/PICK + TEAM #/LEAGUE #) on OpenSea
 * and our marketplace. Joins token → owner (draftTokens/{id}.OwnerId) → the
 * full pick list (getDraftSummary, has ownerAddress + pickNum + playerId).
 * Best-effort per token; only sets the `Image` field (merge), never throws.
 */
async function writeFullDataImages(draftId: string, tokenIds: string[]): Promise<number> {
  const db = getAdminFirestore();

  // Full pick list, grouped by owner wallet.
  let byOwner = new Map<string, Array<{ playerId: string; pickNum: number }>>();
  try {
    const summary = await getDraftSummary(draftId);
    for (const item of summary) {
      const info = item?.playerInfo;
      const owner = (info?.ownerAddress || '').toLowerCase();
      if (!owner || !info?.playerId) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push({ playerId: info.playerId, pickNum: Number(info.pickNum) || 0 });
    }
  } catch (err) {
    logger.warn('marketplace.refresh_draft_summary_failed', { draftId, error: String(err) });
    byOwner = new Map();
  }
  if (byOwner.size === 0) return 0;

  // Numeric league id (matches the Go-written LEAGUE-NAME "BBB #N" → N).
  let leagueNo = draftId.replace(/\D/g, '');
  try {
    const info = await getDraftInfo(draftId);
    leagueNo = (info.displayName || '').replace(/\D/g, '') || leagueNo;
  } catch { /* keep draftId-derived */ }

  let written = 0;
  await Promise.all(
    tokenIds.map(async (tokenId) => {
      try {
        const snap = await db.collection('draftTokens').doc(tokenId).get();
        if (!snap.exists) return;
        const owner = String(snap.get('OwnerId') ?? snap.get('_ownerId') ?? snap.get('ownerId') ?? '').toLowerCase();
        const level = String(snap.get('Level') ?? snap.get('_level') ?? 'Pro');
        if (!owner) return;
        const picks = byOwner.get(owner);
        if (!picks || picks.length < 10) return;

        const players: CardPlayer[] = picks
          .slice()
          .sort((a, b) => a.pickNum - b.pickNum)
          .map((p) => {
            const [tm, ps] = p.playerId.split('-');
            const m = PLAYER_META.get(p.playerId);
            return { team: tm || '', pos: ps || '', bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: p.pickNum };
          });

        const image = buildOgCardUrl({ tier: tierFromLevel(level), passNo: tokenId, teamNo: tokenId, leagueNo, players });
        await db.collection('draftTokenMetadata').doc(tokenId).set({ Image: image }, { merge: true });

        // Stamp the marketplace index DIRECTLY at draft close — so this team is
        // in the JP/HOF/League filters the instant the draft ends, instead of
        // waiting for OpenSea to (maybe) call our metadata endpoint back. Same
        // data the metadata route would write; keyed by the on-chain token id.
        await upsertMarketplaceIndex(tokenId, {
          level: normalizeLevel(level),
          leagueNumber: leagueNo ? Number(leagueNo) : null,
          status: 'team',
          image,
          roster: players.map((p) => `${p.team} ${p.pos}`),
        });
        written += 1;
      } catch { /* skip this token, keep the rest */ }
    }),
  );
  return written;
}

/**
 * Credit banana ripeness to every participant the instant the draft FILLS.
 * Recomputes each owner's tier from their paid-drafts-done count, which unlocks
 * the earned ripeness badge (the FIRST Unripe banana at 1 paid draft) and fires
 * the bell + toast. Best-effort per owner; never blocks the draft close.
 */
async function creditDraftRipeness(tokenIds: string[]): Promise<void> {
  const db = getAdminFirestore();
  const owners = new Set<string>();
  await Promise.all(tokenIds.map(async (id) => {
    try {
      const snap = await db.collection('draftTokens').doc(id).get();
      const o = String(snap.get('OwnerId') ?? snap.get('_ownerId') ?? snap.get('ownerId') ?? '').toLowerCase();
      if (o && !o.startsWith('bot-')) owners.add(o);
    } catch { /* skip */ }
  }));
  await Promise.all([...owners].map(async (o) => {
    try { await computeAndStoreRipeness(o, await countPaidDraftsDone(o)); }
    catch (err) { logger.warn('marketplace.refresh_draft_ripeness_failed', { owner: o, error: String(err) }); }
  }));
}

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

    // Write the full-data team image for ALL tokens FIRST, so the OpenSea
    // refresh below pulls the new card art (not the old Go GCS image).
    const imagesWritten = await writeFullDataImages(draftId, tokenIds);
    logger.info('marketplace.refresh_draft_images', { draftId, imagesWritten, total: tokenIds.length });

    // Draft has filled → credit banana ripeness to each participant (unlocks the
    // earned tier badge + fires the bell/toast). Awaited so it lands; best-effort.
    await creditDraftRipeness(tokenIds);

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

    return json({ ok: true, draftId, refreshed, total: tokenIds.length, failed, imagesWritten });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error(LOG_SOURCES.marketplace.REFRESH_DRAFT_FAILED, { err, draftId });
    return jsonError('Internal Server Error', 500);
  }
}
