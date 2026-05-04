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

    // Look up referrer by code in Firestore
    const db = getAdminFirestore();
    const codeSnap = await db.collection(REFERRAL_CODES_COLLECTION).doc(referrerCode).get();

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

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[referrals/track]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
