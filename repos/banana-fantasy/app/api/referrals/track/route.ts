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

    // Will this referral actually credit the friend? A "new player" who earns
    // their referrer credit is someone who (a) has NOT drafted yet, and (b) is
    // NOT a returning player from a previous season (the imported list). Account
    // age / balances don't matter — only those two things.
    let eligible = true;
    try {
      const userRef = db.collection('v2_users').doc(referredUserId);
      const [snap, draftedSnap] = await Promise.all([
        userRef.get(),
        userRef.collection('draftHistory').limit(1).get(),
      ]);
      const u = (snap.data() ?? {}) as { isReturningPlayer?: boolean };
      const { isReturningWalletSync } = await import('@/lib/returningUsers');
      const isReturning = u.isReturningPlayer === true || isReturningWalletSync(referredUserId);
      const hasDrafted = !draftedSnap.empty;
      eligible = !hasDrafted && !isReturning;
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
