/**
 * GET /api/marketplace/holders?tokens=1,2,3 — current holder for any of these tokens that were bought on the
 * marketplace. Used by the league popup so a bought team shows its buyer, not the drafter (GatorMAB 2026-09-22).
 * Tokens that were never traded are omitted. Public data. CDN-cached 5 min per URL.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getSearchParam, json } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { resolveHolders } from '@/lib/marketplace/holders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  const headers = { 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' };
  if (!isFirestoreConfigured()) return json({ holders: {} }, { status: 200, headers });
  const ids = Array.from(new Set((getSearchParam(req, 'tokens') || '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))).slice(0, 200);
  if (!ids.length) return json({ holders: {} }, { status: 200, headers });
  const map = await resolveHolders(getAdminFirestore(), ids);
  return json({ holders: Object.fromEntries(map) }, { status: 200, headers });
}
