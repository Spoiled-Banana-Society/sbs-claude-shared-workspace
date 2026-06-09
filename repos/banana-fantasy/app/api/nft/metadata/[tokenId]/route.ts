import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { resolveCard } from '@/lib/nftCardServer';
import { passTypeLabel } from '@/lib/nftPassClassify';
import { resolveLeagueNumber } from '@/lib/opensea';
import { upsertMarketplaceIndex, normalizeLevel } from '@/lib/marketplaceIndex';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nft/metadata/[tokenId]
 *
 * The BBB4 tokenURI resolves here (baseURI = ".../api/nft/metadata/").
 * ERC-721 / OpenSea JSON keyed on the on-chain token id. The image is always
 * the obsidian card (resolveCard): drafted → tier team, un-drafted → grey pass.
 * Drafted-or-not is authoritative (exact realTokenId roster), so a minted-but-
 * undrafted pass never false-renders as a team.
 */
export async function GET(_req: Request, { params }: { params: { tokenId: string } }) {
  const tokenId = String(params.tokenId || '').trim().replace(/\.json$/i, '');
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=30, s-maxage=60' };
  if (!/^\d+$/.test(tokenId)) {
    return new Response(JSON.stringify({ error: 'invalid token id' }), { status: 400, headers });
  }

  let card;
  try {
    card = await resolveCard(tokenId);
  } catch (err) {
    logger.warn('nft.metadata_resolve_failed', { tokenId, error: String(err) });
    card = { image: '', drafted: false, level: 'Pro', players: [] };
  }

  if (!card.drafted) {
    // Authoritative: resolveCard already consulted the Go API's CURRENT
    // pass/team split (classifyToken). If it says this token is an undrafted
    // pass, render the grey pass — do NOT second-guess it from the index.
    //
    // We deliberately do NOT "stick" a prior index 'team' record here. On
    // staging, on-chain ids get reused across contract eras (a number that was
    // a drafted team last era is re-minted as a fresh pass this era), so
    // "once a team, always a team" is FALSE and would freeze those ghosts as
    // teams forever, blocking the index's self-healing. The pass-upsert below
    // heals any stale 'team' record back to 'pass'.
    const passType = passTypeLabel(card.passType);
    // Self-healing stamp. Awaited (best-effort, never throws) because Vercel
    // freezes the function after the response — a fire-and-forget write wouldn't
    // land. This route is OFF the live-draft/generating hot path, so the ~30ms
    // is invisible there. Passes have no league.
    await upsertMarketplaceIndex(tokenId, { level: normalizeLevel(card.level), status: 'pass', image: card.image });
    return new Response(JSON.stringify({
      name: `Draft Pass #${tokenId}`,
      description: 'A Banana Best Ball IV draft pass. Reveals into your Digital Team after you draft.',
      image: card.image || `https://banana-fantasy-sbs.vercel.app/api/og/team-card?d=`,
      attributes: [
        { trait_type: 'Status', value: 'Draft Pass' },
        { trait_type: 'Pass Type', value: passType },
        { trait_type: 'Draft Pass #', value: tokenId },
      ],
    }), { status: 200, headers });
  }

  // Drafted team. NAME is ALWAYS the clean "Team #{tokenId}" — never the stale
  // Go-written name (which was "BBB pass #N"); we only read the doc for the real
  // player attributes. This is what makes OpenSea distinguish Draft Pass # vs
  // Team # correctly (and updates to Team # on the metadata refresh after draft).
  const name = `Team #${tokenId}`;
  let rawAttributes = card.players.map((p, i) => ({ trait_type: `${p.pos}${i + 1}`, value: `${p.team} ${p.pos}` }));
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('draftTokenMetadata').doc(tokenId).get();
      if (snap.exists) {
        const d = snap.data() as Record<string, unknown>;
        const rawAttrs = (d.Attributes ?? d.attributes ?? []) as Array<Record<string, unknown>>;
        const mapped = rawAttrs
          .map((a) => ({ trait_type: String(a.Trait_Type ?? a.trait_type ?? ''), value: String(a.Value ?? a.value ?? '') }))
          .filter((a) => a.trait_type);
        if (mapped.length) rawAttributes = mapped;
      }
    } catch { /* keep built */ }
  }

  // Normalize traits for clean OpenSea display + filtering:
  //  - drop the messy free-text LEAGUE-NAME ("BBB #1366") trait,
  //  - stamp clean identity traits (Status / Team # / League #) up front,
  //  - keep Level (JP/HOF/Pro filter), roster slots, and prizes for filtering.
  const leagueNameAttr = rawAttributes.find((a) => /league-?name/i.test(a.trait_type))?.value ?? null;
  const leagueNumber = resolveLeagueNumber(card.image || null, leagueNameAttr);
  // Drop the messy free-text league name AND the stale finalize-doc LEVEL — the
  // authoritative level is card.level (from the chain-anchored index), so an
  // old/collided finalize doc can't show e.g. "Pro" on a real Jackpot token.
  const kept = rawAttributes.filter((a) => !/league-?name/i.test(a.trait_type) && a.trait_type.trim().toUpperCase() !== 'LEVEL');
  const attributes = [
    { trait_type: 'Status', value: 'Team' },
    { trait_type: 'Team #', value: tokenId },
    { trait_type: 'Level', value: card.level },
    ...(leagueNumber != null ? [{ trait_type: 'League #', value: String(leagueNumber) }] : []),
    ...kept,
  ];

  // Self-healing stamp keyed by the on-chain id. Awaited (best-effort) so it
  // actually lands in Vercel serverless. Off the hot path. Powers the instant
  // JP/HOF + League # marketplace filters.
  await upsertMarketplaceIndex(tokenId, {
    level: normalizeLevel(card.level),
    leagueNumber,
    status: 'team',
    image: card.image,
    roster: card.players.map((p) => `${p.team} ${p.pos}`),
    // Persist the full structured pick list so future rebuilds are self-contained
    // (no Go dependency). resolveCard captured real picks into card.players.
    players: card.players.map((p) => ({ team: p.team, pos: p.pos, pick: p.pick, bye: p.bye, adp: p.adp })),
  });

  return new Response(JSON.stringify({
    name,
    description: 'A Banana Best Ball IV team — onchain fantasy football on Base.',
    image: card.image,
    attributes,
  }), { status: 200, headers });
}
