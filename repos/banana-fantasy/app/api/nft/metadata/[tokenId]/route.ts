import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { resolveCard } from '@/lib/nftCardServer';
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
    return new Response(JSON.stringify({
      name: `Banana Best Ball IV — Draft Pass #${tokenId}`,
      description: 'A Banana Best Ball IV draft pass. Reveals into your Digital Team after you draft.',
      image: card.image || `https://banana-fantasy-sbs.vercel.app/api/og/team-card?d=`,
      attributes: [{ trait_type: 'Status', value: 'Draft Pass' }],
    }), { status: 200, headers });
  }

  // Drafted team — prefer the Go-written doc (real player names) for name/attrs.
  let name = `Banana Best Ball IV Team #${tokenId}`;
  let attributes = card.players.map((p, i) => ({ trait_type: `${p.pos}${i + 1}`, value: `${p.team} ${p.pos}` }));
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('draftTokenMetadata').doc(tokenId).get();
      if (snap.exists) {
        const d = snap.data() as Record<string, unknown>;
        const storedName = String(d.Name ?? d.name ?? '');
        if (storedName) name = storedName;
        const rawAttrs = (d.Attributes ?? d.attributes ?? []) as Array<Record<string, unknown>>;
        const mapped = rawAttrs
          .map((a) => ({ trait_type: String(a.Trait_Type ?? a.trait_type ?? ''), value: String(a.Value ?? a.value ?? '') }))
          .filter((a) => a.trait_type);
        if (mapped.length) attributes = mapped;
      }
    } catch { /* keep built */ }
  }

  return new Response(JSON.stringify({
    name,
    description: 'A Banana Best Ball IV team — onchain fantasy football on Base.',
    image: card.image,
    attributes,
  }), { status: 200, headers });
}
