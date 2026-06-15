import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getDraftSummary, getDraftInfo } from '@/lib/draftApi';
import { buildOgCardUrl } from '@/lib/nftCard';
import { upsertMarketplaceIndex, normalizeLevel } from '@/lib/marketplaceIndex';
import { currentMaxTokenId, isRealToken } from '@/lib/onchain/contractSupply';
import { awardJackpotDraw, computeAndStoreRipeness, recordFirstPurchaseDraftFinished, recordPick10, allBatchSpecialsHit, announcePick10ExpansionIfActivated } from '@/lib/db';
import { pushStreamEventBg } from '@/lib/userEventStream';
import { waitUntil } from '@vercel/functions';
import { fetchOwnerPaidFilledCount } from '@/lib/api/owner';
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
async function writeFullDataImages(
  draftId: string,
  tokenIds: string[],
): Promise<{ written: number; eligible: number }> {
  const db = getAdminFirestore();
  // The current on-chain supply cap — a token can only ever get a marketplace_index
  // doc if its REAL id is at/below this (upsertMarketplaceIndex rejects the rest).
  // We count only those toward capture completeness so bot/synthetic tokens that
  // never get indexed can't make the draft look permanently uncaptured.
  const maxId = await currentMaxTokenId();

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
  if (byOwner.size === 0) return { written: 0, eligible: 0 };

  // Numeric league id (matches the Go-written LEAGUE-NAME "BBB #N" → N).
  let leagueNo = draftId.replace(/\D/g, '');
  try {
    const info = await getDraftInfo(draftId);
    leagueNo = (info.displayName || '').replace(/\D/g, '') || leagueNo;
  } catch { /* keep draftId-derived */ }

  let written = 0;
  let eligible = 0;
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

        // Prefer the REAL on-chain id for the card identity + index key. The
        // cards-doc id is usually the on-chain id already, but on staging it can
        // be a synthetic cardId — RealTokenId (when set) is authoritative.
        const rawReal = String(snap.get('RealTokenId') ?? snap.get('realTokenId') ?? '').trim();
        const realId = /^\d{1,7}$/.test(rawReal) ? String(Number(rawReal)) : tokenId;

        const players: CardPlayer[] = picks
          .slice()
          .sort((a, b) => a.pickNum - b.pickNum)
          .map((p) => {
            const [tm, ps] = p.playerId.split('-');
            const m = PLAYER_META.get(p.playerId);
            return { team: tm || '', pos: ps || '', bye: m?.byeWeek ?? '-', adp: m?.adp ?? '-', pick: p.pickNum };
          });

        const image = buildOgCardUrl({ tier: tierFromLevel(level), passNo: realId, teamNo: realId, leagueNo, players });
        await db.collection('draftTokenMetadata').doc(tokenId).set({ Image: image }, { merge: true });
        if (realId !== tokenId) {
          // Mirror under the on-chain id too — the metadata endpoint reads by it.
          await db.collection('draftTokenMetadata').doc(realId).set({ Image: image }, { merge: true });
        }

        // Only a REAL on-chain id can get a marketplace_index doc — count those
        // toward "eligible" BEFORE the upsert so a thrown (transient) upsert
        // leaves written < eligible and the capture cron retries. Bot/synthetic
        // tokens (realId not on-chain) are neither eligible nor written, so they
        // never make the draft look permanently uncaptured.
        const indexable = isRealToken(realId, maxId);
        if (indexable) eligible += 1;

        // Stamp the marketplace index DIRECTLY at draft close — so this team is
        // in the JP/HOF/League filters the instant the draft ends, instead of
        // waiting for OpenSea to (maybe) call our metadata endpoint back. Same
        // data the metadata route would write; keyed by the on-chain token id.
        // (upsert itself rejects non-real ids, so this is safe either way.)
        await upsertMarketplaceIndex(realId, {
          level: normalizeLevel(level),
          leagueNumber: leagueNo ? Number(leagueNo) : null,
          status: 'team',
          image,
          roster: players.map((p) => `${p.team} ${p.pos}`),
          // Durable structured pick list — so we can regenerate this card forever
          // from OUR Firestore, even after the Go draft summary expires.
          players: players.map((p) => ({ team: p.team, pos: p.pos, pick: p.pick, bye: p.bye, adp: p.adp })),
        });
        if (indexable) written += 1;
      } catch { /* skip this token, keep the rest */ }
    }),
  );
  return { written, eligible };
}

/**
 * Credit banana ripeness to every participant the instant the draft FILLS.
 * Recomputes each owner's tier from their paid-drafts-done count, which unlocks
 * the earned ripeness badge (the FIRST Unripe banana at 1 paid draft) and fires
 * the bell + toast. Best-effort per owner; never blocks the draft close.
 */
async function creditDraftRipeness(draftId: string, tokenIds: string[], isJackpot: boolean): Promise<void> {
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
    try { await computeAndStoreRipeness(o, await fetchOwnerPaidFilledCount(o)); }
    catch (err) { logger.warn('marketplace.refresh_draft_ripeness_failed', { owner: o, error: String(err) }); }

    // SERVER-SIDE promo crediting at close — these used to be browser-fired
    // only (results page / draft room), so a user who closed the tab missed
    // them forever. Both are idempotent per draftId and internally gated
    // (paid-only via the token stamp; jackpot additionally re-derives the
    // single deterministic winner — calling it for every owner is the same
    // thing the per-drafter client calls did).
    try { await recordFirstPurchaseDraftFinished(o, draftId); }
    catch (err) { logger.warn('marketplace.refresh_draft_first_purchase_gate_failed', { owner: o, error: String(err) }); }
    if (isJackpot) {
      try { await awardJackpotDraw(draftId); }
      catch (err) { logger.warn('marketplace.refresh_draft_jackpot_credit_failed', { owner: o, error: String(err) }); }
      // If the draw's instant on-chain receipt failed at draw time (RPC
      // blip), post it now — no-op once receiptTxHash exists.
      try {
        const { ensureDrawReceipt } = await import('@/lib/jackpotDrawProof');
        await ensureDrawReceipt(draftId);
      } catch (err) { logger.warn('marketplace.refresh_draft_receipt_backstop_failed', { owner: o, error: String(err) }); }
    }

    // Silent content-less refetch ping: the team card image was JUST written
    // to marketplace_index — nudge every device of this owner to refetch so
    // My Teams swaps the grey pass for the real team image in ~300ms.
    // Deliberately NOT a bell notification (Boris 2026-06-10 — the generating
    // screen already covers the announcement); 'notification' pings with no
    // content trigger the stream-refetch hooks and nothing else.
    pushStreamEventBg(o, 'notification', { source: 'draft-close-team-image' });
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
    if (!draftId) {
      return jsonError('Missing draftId', 400);
    }
    // NOTE: do NOT gate the whole route on OPENSEA_API_KEY. The critical work
    // here — writing the team card image to OUR marketplace_index + firing the
    // per-owner real-time refetch ping — is driven entirely by OUR Firestore
    // and is what makes a freshly-generated team appear live on every page
    // (Sell, Teams, marketplace). It must run on day-one of a NEW prod contract,
    // before OpenSea has indexed anything. Only the OpenSea re-index call below
    // needs the key, and it's already best-effort.

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
    const { written: imagesWritten, eligible } = await writeFullDataImages(draftId, tokenIds);
    logger.info('marketplace.refresh_draft_images', { draftId, imagesWritten, eligible, total: tokenIds.length });

    // Stamp the AUTHORITATIVE capture-complete marker once every REAL team is
    // indexed. The capture-draft-data cron reads this (not a per-token index
    // scan) as "done" — immune to the cardId-vs-realId key mismatch and to bot/
    // short tokens that made the old per-token check false-negative forever
    // (the permanent `gave_up` bug). Only stamp on a COMPLETE capture
    // (written >= eligible) so a genuine partial failure is still retried.
    if (eligible > 0 && imagesWritten >= eligible) {
      try {
        await db.collection('marketplace_capture').doc(draftId).set(
          { capturedAt: FieldValue.serverTimestamp(), count: imagesWritten, eligible },
          { merge: true },
        );
      } catch (err) {
        logger.warn('marketplace.refresh_draft_capture_marker_failed', { draftId, error: String(err) });
      }
    }

    // Draft closed → per-owner credits: banana ripeness (tier badge + bell/
    // toast), the first-purchase gate, jackpot-hit spins when this draft
    // revealed as Jackpot, and the silent My Teams refresh ping. The revealed
    // level lives on the cards docs (same field the proof feed reads).
    const isJackpot = cardsSnap.docs.some((d) =>
      String((d.data() as Record<string, unknown>)?.Level ?? '').toLowerCase().includes('jackpot'),
    );
    await creditDraftRipeness(draftId, tokenIds, isJackpot);

    // Pick 10 — GUARANTEED backstop at close (the order doesn't exist at the
    // fill instant; the reveal-complete route credits earlier when anyone
    // watched the reveal; idempotent per draft + paid-gated internally).
    try {
      const info = await getDraftInfo(draftId);
      const order = info?.draftOrder ?? [];
      const draftName = info?.displayName ?? draftId;
      // Slot 10 always; once the current 100-batch's specials (1 JP + 5 HOF)
      // are all hit, Pick 10 expands to also reward slots 6 and 9 (reverts at
      // the next batch). recordPick10 is idempotent per (user, draft) + paid-gated.
      const expanded = await allBatchSpecialsHit();
      const slots = expanded ? [6, 9, 10] : [10];
      for (const slot of slots) {
        const owner = order[slot - 1]?.ownerId?.toLowerCase();
        if (owner && !owner.startsWith('bot-')) {
          await recordPick10(owner, draftId, draftName, undefined, slot);
        }
      }
      // Promo live this batch → one-time bell + push to everyone. Backgrounded
      // so the close pipeline isn't held up; idempotent per batch (the
      // reveal-complete route may have already announced — this is the backstop).
      if (expanded) waitUntil(announcePick10ExpansionIfActivated());
    } catch (err) {
      logger.warn('marketplace.refresh_draft_pick10_backstop_failed', { draftId, err: String(err) });
    }

    // OpenSea re-index — best-effort, and only if the key is configured. Our
    // own index + the real-time ping above already made the team live; this
    // just nudges OpenSea's copy. Skipped (not failed) when no key, so a new
    // prod contract without OpenSea wiring still completes successfully.
    const results = OPENSEA_API_KEY
      ? await Promise.allSettled(tokenIds.map((id) => refreshToken(id)))
      : [];
    const ok = (i: number) =>
      results[i]?.status === 'fulfilled' && (results[i] as PromiseFulfilledResult<boolean>).value;
    const refreshed = OPENSEA_API_KEY ? tokenIds.filter((_, i) => ok(i)).length : 0;
    const failed = OPENSEA_API_KEY ? tokenIds.filter((_, i) => !ok(i)) : [];

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
