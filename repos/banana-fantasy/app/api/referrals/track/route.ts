import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { trackReferral } from '@/lib/db';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

const REFERRAL_CODES_COLLECTION = 'v2_referral_codes';

/**
 * POST /api/referrals/track — Link a referred user to their referrer
 * Body: { referrerCode, referredUserId, referredUsername }
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.general);
  if (rl) return rl;

  try {
    const body = await req.json();
    const { referrerCode, referredUserId, referredUsername } = body;

    if (!referrerCode || !referredUserId) {
      return NextResponse.json({ error: 'Missing referrerCode or referredUserId' }, { status: 400 });
    }

    // Look up referrer by code in Firestore. Name-based codes are stored
    // with an UPPERCASE doc id (links get typed/shared in any case); legacy
    // BANANA-… codes were already uppercase, so this is back-compatible.
    const db = getAdminFirestore();
    const codeId = String(referrerCode).replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();
    const codeSnap = await db.collection(REFERRAL_CODES_COLLECTION).doc(codeId).get();

    let referrerUserId: string | null = null;
    if (codeSnap.exists) {
      referrerUserId = (codeSnap.data() as { userId: string }).userId;
    }

    if (!referrerUserId) {
      return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 });
    }

    // Don't let users refer themselves
    if (referrerUserId === referredUserId) {
      return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 });
    }

    const result = await trackReferral(
      referrerUserId,
      referredUserId,
      referredUsername || `User${referredUserId}`,
    );

    // Will this referral actually credit the friend? Referral rewards pay out
    // only via the new-player flow (verify X → claim spin → buy). Use the SAME
    // "new player" definition as /api/promos so it's consistent: a real
    // (non-estimated) createdAt within 7 days counts as new; otherwise the
    // account must be zero-activity. An established account → won't credit.
    let eligible = true;
    try {
      const snap = await db.collection('v2_users').doc(referredUserId).get();
      const u = (snap.data() ?? {}) as {
        createdAt?: string; createdAtEstimated?: boolean;
        draftPasses?: number; freeDrafts?: number; wheelSpins?: number; usdcBalance?: number;
      };
      const zeroActivity = !(u.draftPasses ?? 0) && !(u.freeDrafts ?? 0) && !(u.wheelSpins ?? 0) && !(u.usdcBalance ?? 0);
      eligible = u.createdAt && !u.createdAtEstimated
        ? Date.now() - new Date(u.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
        : snap.exists && zeroActivity;
    } catch { /* default eligible:true on read error */ }

    return NextResponse.json({
      ...result,
      eligible,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[referrals/track]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
