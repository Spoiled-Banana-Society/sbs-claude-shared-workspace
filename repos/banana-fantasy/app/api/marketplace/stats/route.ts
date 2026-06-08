import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/stats
 *
 * Live totals for the marketplace tab badges — drafted teams, plus Jackpot and
 * HOF counts — read straight from the marketplace_index with Firestore COUNT
 * aggregations (no docs transferred, ~nothing to bill). Cached 60s at the edge
 * since these move slowly. Pro = total - jackpot - hof.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Index not configured', 503);

  try {
    const db = getAdminFirestore();
    const teams = db.collection('marketplace_index').where('status', '==', 'team');
    const [all, jackpot, hof] = await Promise.all([
      teams.count().get(),
      teams.where('level', '==', 'jackpot').count().get(),
      teams.where('level', '==', 'hof').count().get(),
    ]);
    const total = all.data().count;
    const jp = jackpot.data().count;
    const hf = hof.data().count;
    return json(
      { teams: total, jackpot: jp, hof: hf, pro: Math.max(0, total - jp - hf) },
      { status: 200, headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } },
    );
  } catch (err) {
    console.error('[marketplace/stats] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
