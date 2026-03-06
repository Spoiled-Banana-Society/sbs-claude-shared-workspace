import { NextRequest, NextResponse } from 'next/server';
import { trackReferral, updateReferralRewards, getPromos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/referrals/test — Test endpoint: track a referral AND return updated promos
 * Combines both operations in one serverless function so data persists on Vercel.
 * Body: { referrerUserId, referredUserId, referredUsername, milestone? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { referrerUserId, referredUserId, referredUsername, milestone } = body;

    if (!referrerUserId || !referredUserId) {
      return NextResponse.json({ error: 'Missing referrerUserId or referredUserId' }, { status: 400 });
    }

    // Step 1: Track the referral
    const trackResult = await trackReferral(referrerUserId, referredUserId, referredUsername || 'TestFriend');

    // Step 2: Optionally trigger a milestone reward
    let rewardResult = null;
    if (milestone) {
      rewardResult = await updateReferralRewards(referredUserId, milestone);
    }

    // Step 3: Return updated promos so we can see the result
    const promos = await getPromos(referrerUserId);
    const referralPromo = promos.find(p => p.type === 'referral');

    return NextResponse.json({
      trackResult,
      rewardResult,
      referralHistory: referralPromo?.modalContent?.referralHistory ?? [],
      claimCount: referralPromo?.claimCount ?? 0,
      claimable: referralPromo?.claimable ?? false,
    });
  } catch (err) {
    console.error('[referrals/test]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
