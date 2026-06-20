import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { isFirestoreConfigured, getAdminFirestore } from '@/lib/firebaseAdmin';
import { getTeamsForTokens } from '@/lib/marketplace/teamData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FOUNDER_DRAFTS_COLLECTION = 'founderDrafts';

/**
 * POST /api/founder-drafts/by-tokens
 * Body: { tokens: [{ tokenId, owner?, leagueId? }] }
 * Returns: { founderTokenIds: string[] }
 *
 * READ-ONLY batch check: which of the given teams were drafted in a Founder
 * Draft. Used to show a FOUNDER label on team cards (marketplace + My Teams)
 * with ONE request per page instead of a per-card fetch (no N+1 / no Rule #0
 * render-loop risk). A team's leagueId == the founder draftId, so we check
 * membership against the small `founderDrafts` collection (its doc ids ARE the
 * founder draft ids). Cards that already know their leagueId skip resolution.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  try {
    if (!isFirestoreConfigured()) return json({ founderTokenIds: [] });

    const body = await parseBody(req);
    const tokensIn = Array.isArray(body?.tokens) ? body.tokens : [];
    const tokens = tokensIn
      .map((t: { tokenId?: unknown; owner?: unknown; leagueId?: unknown }) => ({
        tokenId: String(t?.tokenId ?? '').trim(),
        owner: t?.owner ? String(t.owner).toLowerCase() : null,
        leagueId: t?.leagueId ? String(t.leagueId) : '',
      }))
      .filter((t: { tokenId: string }) => t.tokenId);
    if (tokens.length === 0) return json({ founderTokenIds: [] });

    // Founder draft id set — tiny collection, doc ids only (cheap .select()).
    const db = getAdminFirestore();
    const snap = await db.collection(FOUNDER_DRAFTS_COLLECTION).select().get();
    const founderLeagueIds = new Set(snap.docs.map((d) => d.id));
    if (founderLeagueIds.size === 0) return json({ founderTokenIds: [] });

    // Resolve leagueId only for tokens that didn't supply one (batched per owner).
    const needResolve = tokens.filter((t: { leagueId: string }) => !t.leagueId);
    const resolved = needResolve.length
      ? await getTeamsForTokens(needResolve.map((t: { tokenId: string; owner: string | null }) => ({ tokenId: t.tokenId, owner: t.owner })))
      : new Map();

    const founderTokenIds: string[] = [];
    for (const t of tokens) {
      const leagueId = t.leagueId || resolved.get(t.tokenId)?.leagueId || '';
      if (leagueId && founderLeagueIds.has(leagueId)) founderTokenIds.push(t.tokenId);
    }
    return json({ founderTokenIds });
  } catch {
    return jsonError('by-tokens failed', 500);
  }
}
