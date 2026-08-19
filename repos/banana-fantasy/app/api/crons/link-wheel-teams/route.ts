import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { upsertMarketplaceIndex, normalizeLevel } from '@/lib/marketplaceIndex';
import { refreshOpenSeaTokens } from '@/lib/opensea';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { runInBackground } from '@/lib/serverBackground';

export const dynamic = 'force-dynamic';

/**
 * Link wheel-won JP/HOF pass NFTs to their finished special-draft teams.
 *
 * The wheel mints a REAL pass NFT per JP/HOF win and the queue binds each seat
 * to that tokenId — but the Go engine seats special drafts with a fresh
 * synthetic `special-…` card token and never consumes the NFT. Result: the
 * draft completes, the team exists, and the NFT still reads as an un-revealed
 * "Draft Pass" (no card on My Teams, no download, Sell blocked as an
 * "undrafted free pass"). This cron closes that gap the moment a special
 * draft's 150th pick lands, per token-bound seat:
 *
 *   1. `RealTokenId` on the Go card doc (authoritative link once the Go API
 *      serializes it — inert until then, see NOTES for Boris)
 *   2. delete the leftover `validDraftTokens` "available pass" doc so the
 *      token stops classifying as an unlistable pass
 *   3. copy the roster Attributes from the special-keyed
 *      `draftTokenMetadata/special-…` finalize doc to the on-chain-id key,
 *      so the metadata route reveals the team
 *   4. stamp `marketplace_index` status=team + level (index is authoritative
 *      for pass-vs-team; a 'pass' record short-circuits the reveal)
 *   5. write `nft_league_map/{tokenId}` → leagueId — binds NFT ↔ league for
 *      My Teams / marketplace, and doubles as the idempotence marker (written
 *      LAST, so a crashed run re-does the token instead of half-linking it)
 *   6. best-effort OpenSea metadata refresh
 *
 * The 2026-07-19 backfill (HOF #10 / #12) used this exact recipe manually.
 * Auth: Vercel Cron's `Authorization: Bearer ${CRON_SECRET}`.
 */

const DRAFTS_API_BASE = (
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  process.env.STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');

const SEATS_FALLBACK = 10;
const ROUNDS_PER_DRAFT = 15;
const MIN_ROSTER_ATTRS = 10;

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

/** Has this special draft finished all its picks? Fail-closed (not complete). */
async function isDraftComplete(draftId: string): Promise<boolean> {
  try {
    const res = await fetch(`${DRAFTS_API_BASE}/draft/${encodeURIComponent(draftId)}/state/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const txt = await res.text();
    if (!txt.trim().startsWith('{')) return false; // "draft state not yet initialized"
    const d = JSON.parse(txt) as { pickNumber?: number; draftOrder?: unknown[] };
    const seats = Array.isArray(d.draftOrder) && d.draftOrder.length > 0 ? d.draftOrder.length : SEATS_FALLBACK;
    return typeof d.pickNumber === 'number' && d.pickNumber >= seats * ROUNDS_PER_DRAFT;
  } catch {
    return false;
  }
}

interface QueueMember { wallet: string; tokenId?: string }
interface QueueRound { roundId: number; status: string; draftId?: string | null; members?: QueueMember[] }

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  runInBackground('cron.heartbeat', recordCronHeartbeat('link-wheel-teams'));

  const db = getAdminFirestore();
  let checked = 0;
  let linked = 0;
  const errors: string[] = [];

  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    const queueSnap = await db.collection('v2_queues').doc(type).get();
    if (!queueSnap.exists) continue;
    const rounds = (queueSnap.data()?.rounds ?? []) as QueueRound[];

    for (const round of rounds) {
      const draftId = round.draftId;
      const tokenMembers = (round.members ?? []).filter(m => m.tokenId && /^\d+$/.test(String(m.tokenId)));
      if (!draftId || round.status === 'filling' || tokenMembers.length === 0) continue;

      // One map read per token tells us if the round is already fully linked —
      // only then pay for the Go completeness call.
      const pending: QueueMember[] = [];
      for (const m of tokenMembers) {
        const map = await db.collection('nft_league_map').doc(String(m.tokenId)).get();
        if (map.exists && map.get('leagueId') === draftId) continue;
        pending.push(m);
      }
      checked += tokenMembers.length;
      if (pending.length === 0) continue;
      if (!(await isDraftComplete(draftId))) continue;

      // Cards fetched once per round; matched to seats by owner wallet.
      const cardsSnap = await db.collection('drafts').doc(draftId).collection('cards').get();
      const cards = cardsSnap.docs.map(d => ({ ref: d.ref, id: d.id, data: d.data() as Record<string, unknown> }));

      for (const m of pending) {
        const tokenId = String(m.tokenId);
        const wallet = m.wallet.toLowerCase();
        try {
          // COLLISION GUARD: if this token is already a DIFFERENT team, never
          // relabel it. Early wheel passes (pre level-lock) could be spent into
          // a regular draft while their queue seat kept the stale token binding
          // — token 873 was both BBB #104 and an HOF #12 seat, and blind linking
          // corrupted the real team's card (2026-07-19). Such a seat has no NFT
          // of its own; flag it for a human instead.
          const ix = await db.collection('marketplace_index').doc(tokenId).get();
          if (ix.exists && ix.get('status') === 'team') {
            logger.error('link_wheel_teams.token_already_team', {
              type, draftId, tokenId, wallet,
              existingLeagueNumber: ix.get('leagueNumber') ?? null,
              note: 'wheel seat token already belongs to another team (pre-lock double-spend) — needs manual resolution, skipping',
            });
            continue;
          }
          const card = cards.find(c => String(c.data.OwnerId ?? '').toLowerCase() === wallet);
          if (!card) throw new Error('no card doc for seat wallet');
          const cardId = String(card.data.CardId ?? card.id);

          const srcSnap = await db.collection('draftTokenMetadata').doc(cardId).get();
          if (!srcSnap.exists) throw new Error(`no finalize doc draftTokenMetadata/${cardId}`);
          const attrs = (srcSnap.get('Attributes') ?? srcSnap.get('attributes') ?? []) as Array<Record<string, unknown>>;
          const rosterAttrs = attrs.filter(a => /^(QB|RB|WR|TE|DST)\d+$/i.test(String(a.Trait_Type ?? a.trait_type ?? '')));
          if (rosterAttrs.length < MIN_ROSTER_ATTRS) throw new Error(`finalize doc has only ${rosterAttrs.length} roster attrs`);

          await card.ref.set({ RealTokenId: tokenId }, { merge: true });
          await db.collection('owners').doc(wallet).collection('validDraftTokens').doc(tokenId).delete();
          await db.collection('draftTokenMetadata').doc(tokenId).set(
            { Attributes: attrs, Name: `BBB pass #${tokenId}` },
            { merge: true },
          );
          await upsertMarketplaceIndex(tokenId, {
            status: 'team',
            // 'jackhof' rounds are BOTH — stamp the dual label or the card
            // rebuilds as plain HOF (JackHOF #30, 2026-08-19).
            level: normalizeLevel(type === 'jackhof' ? 'JackHOF' : type === 'jackpot' ? 'Jackpot' : 'Hall of Fame'),
            levelRaw: type === 'jackhof' ? 'JackHOF' : type === 'jackpot' ? 'Jackpot' : 'Hall of Fame',
          });
          // LAST write = idempotence marker (see step 5 in the header comment).
          await db.collection('nft_league_map').doc(tokenId).set({
            tokenId,
            leagueId: draftId,
            ownerAtMap: wallet,
            mappedAt: Date.now(),
            mappedBy: 'cron:link-wheel-teams',
          }, { merge: true });

          runInBackground('link-wheel-teams.opensea', refreshOpenSeaTokens([tokenId]));
          logger.info('link_wheel_teams.linked', { type, draftId, tokenId, wallet });
          linked++;
        } catch (err) {
          const msg = `${type}/${draftId}/token ${tokenId}: ${(err as Error).message}`;
          errors.push(msg);
          logger.warn('link_wheel_teams.failed', { type, draftId, tokenId, wallet, err: (err as Error).message });
        }
      }
    }
  }

  return json({ ok: true, checked, linked, errors });
}
