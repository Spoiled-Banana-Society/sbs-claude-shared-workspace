export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getFillingWheelPassLevels } from '@/lib/db';

/**
 * GET /api/queues/wheel-pass-filling?tokenIds=1,2,3
 *
 * Returns { levels: { [tokenId]: 'jackpot' | 'hof' } } for any of the given tokens
 * that is a wheel-won JP/HOF pass currently in a STILL-FILLING queue round (so it's
 * sellable on our marketplace until its draft fills). Tokens not in a filling round
 * are omitted. Best-effort: returns {} on error rather than failing the caller.
 */
export async function GET(req: NextRequest) {
  const tokenIdsParam = req.nextUrl.searchParams.get('tokenIds');
  if (!tokenIdsParam) return NextResponse.json({ levels: {} });
  const tokenIds = tokenIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (tokenIds.length === 0) return NextResponse.json({ levels: {} });
  try {
    const levels = await getFillingWheelPassLevels(tokenIds);
    return NextResponse.json({ levels });
  } catch (err) {
    console.error('[wheel-pass-filling] error:', err);
    return NextResponse.json({ levels: {} });
  }
}
