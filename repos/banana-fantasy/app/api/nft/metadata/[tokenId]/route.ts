import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getTeamForToken, getOwnerForToken, teamDataToTraits } from '@/lib/marketplace/teamData';
import { resolveTokenImage } from '@/lib/nftCardServer';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nft/metadata/[tokenId]
 *
 * The BBB4 contract's tokenURI resolves here (baseURI = ".../api/nft/metadata/").
 * Returns ERC-721 / OpenSea-standard JSON keyed on the on-chain token id.
 *
 * The image is ALWAYS the obsidian card (resolveTokenImage): a stored og URL
 * (our full-data write) if present, else built live — drafted → tier team,
 * un-drafted → grey draft pass. The old Go-written GCS image is never served.
 * Drafted-or-not is decided by the Go API (authoritative), not by stale docs.
 */
export async function GET(_req: Request, { params }: { params: { tokenId: string } }) {
  const tokenId = String(params.tokenId || '').trim().replace(/\.json$/i, '');
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=30, s-maxage=60' };
  if (!/^\d+$/.test(tokenId)) {
    return new Response(JSON.stringify({ error: 'invalid token id' }), { status: 400, headers });
  }

  let team = null;
  try {
    const owner = await getOwnerForToken(tokenId);
    team = await getTeamForToken(tokenId, owner);
  } catch (err) {
    logger.warn('nft.metadata_resolve_failed', { tokenId, error: String(err) });
  }
  const drafted = !!team && Array.isArray(team.roster) && team.roster.length >= 10;

  const image = await resolveTokenImage(tokenId, team);

  // Name + attributes: for a drafted team prefer the Go-written doc (real player
  // names), else the live team traits. Un-drafted → a plain draft pass.
  let name = `Banana Best Ball IV — Draft Pass #${tokenId}`;
  let description = 'A Banana Best Ball IV draft pass. Reveals into your Digital Team after you draft.';
  let attributes: { trait_type: string; value: string }[] = [{ trait_type: 'Status', value: 'Draft Pass' }];

  if (drafted && team) {
    description = 'A Banana Best Ball IV team — onchain fantasy football on Base.';
    name = team.leagueDisplayName || `Banana Best Ball IV Team #${tokenId}`;
    attributes = teamDataToTraits(team).map((t) => ({ trait_type: t.trait_type, value: String(t.value) }));
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
      } catch { /* keep live traits */ }
    }
  }

  return new Response(JSON.stringify({ name, description, image, attributes }), { status: 200, headers });
}
