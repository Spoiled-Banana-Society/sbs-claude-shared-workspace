import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import type { MarketplaceTeam } from '@/lib/opensea';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/wheel-passes
 *
 * Every LIVE special-draft pass — wheel-won JP/HOF NFTs sitting in a
 * still-FILLING queue round — straight from the queue documents, so a pass
 * appears here the moment the wheel mints it (no listing required). The
 * marketplace merges these into the Passes/HOF/Jackpot/All browse views;
 * listed ones gain price/Buy Now from the listings source.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { getAdminFirestore, isFirestoreConfigured } = await import('@/lib/firebaseAdmin');
    if (!isFirestoreConfigured()) return json({ passes: [] });
    const db = getAdminFirestore();

    const passes: MarketplaceTeam[] = [];
    for (const type of ['jackpot', 'hof'] as const) {
      const snap = await db.collection('v2_queues').doc(type).get();
      if (!snap.exists) continue;
      const queue = snap.data() as { rounds?: Array<{ status: string; members: Array<{ wallet: string; tokenId?: string }> }> };
      for (const round of queue.rounds || []) {
        if (round.status !== 'filling') continue; // sellable window only
        for (const m of round.members || []) {
          if (!m.tokenId) continue; // only wheel-minted NFT slots
          const wallet = (m.wallet || '').toLowerCase();
          passes.push({
            id: String(m.tokenId),
            tokenId: String(m.tokenId),
            name: `Draft Pass #${m.tokenId}`,
            draftType: type === 'jackpot' ? 'jackpot' : 'hof',
            isHof: false, // the NFT tier stamp lands at draft fill — views key off fillingWheelLevel
            isJackpot: false,
            rank: 0,
            points: 0,
            weeklyAvg: 0,
            playoffOdds: 0,
            price: null,
            owner: wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : '',
            ownerAddress: wallet,
            ownerPfp: null,
            roster: [],
            color: type === 'jackpot' ? 'from-error to-red-700' : 'from-hof to-pink-600',
            imageUrl: null, // card renders the tiered pass art from fillingWheelLevel
            orderHash: null,
            protocolAddress: null,
            leagueNumber: null,
            fillingWheelLevel: type,
          });
        }
      }
    }

    // Enrich owner display names (bounded by unique owners; best-effort).
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
    try {
      const uniqueOwners = [...new Set(passes.map(p => p.ownerAddress).filter(Boolean))];
      await Promise.all(uniqueOwners.map(async (addr) => {
        try {
          const res = await fetch(`${DRAFTS_API}/owner/${addr}`, { signal: AbortSignal.timeout(2500) });
          if (!res.ok) return;
          const profile = await res.json();
          for (const p of passes) {
            if (p.ownerAddress !== addr) continue;
            if (profile?.pfp?.displayName) p.owner = profile.pfp.displayName;
            if (profile?.pfp?.imageUrl) p.ownerPfp = profile.pfp.imageUrl;
          }
        } catch { /* skip */ }
      }));
    } catch { /* enrichment is best-effort */ }

    return json({ passes });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/wheel-passes] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
