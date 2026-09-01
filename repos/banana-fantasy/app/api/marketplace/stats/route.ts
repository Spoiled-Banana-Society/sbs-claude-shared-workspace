import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { currentMaxTokenId, isRealToken } from '@/lib/onchain/contractSupply';

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
    // Count only REAL on-chain tokens (<= current contract supply). Fetch ids +
    // level (cheap select) and filter, since a count() aggregation can't exclude
    // prior-era ghost ids. Cached 60s so the per-call read volume is bounded.
    const maxId = await currentMaxTokenId();
    const snap = await db.collection('marketplace_index').where('status', '==', 'team').select('level').get();
    let total = 0, jp = 0, hf = 0;
    snap.forEach((d) => {
      if (!isRealToken(d.id, maxId)) return;
      total++;
      const lvl = d.get('level');
      if (lvl === 'jackpot') jp++; else if (lvl === 'hof') hf++;
    });
    return json(
      { teams: total, jackpot: jp, hof: hf, pro: Math.max(0, total - jp - hf) },
      // 5s/10s (was 30s/60s): tab counts pick up a just-closed draft near-real-time.
      { status: 200, headers: { 'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600' /* 10s->300s (cost audit 9/1): full marketplace_index team scan per miss */ } },
    );
  } catch (err) {
    console.error('[marketplace/stats] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
