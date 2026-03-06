import { NextRequest, NextResponse } from 'next/server';
import { trackReferral, updateReferralRewards } from '@/lib/db';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug/test-referral?action=track&code=XXX&friendId=YYY&friendName=ZZZ
 * GET /api/debug/test-referral?action=verify&friendId=YYY
 * GET /api/debug/test-referral?action=bought1&friendId=YYY
 * GET /api/debug/test-referral?action=bought10&friendId=YYY
 * STAGING ONLY — delete before prod.
 */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  const code = req.nextUrl.searchParams.get('code');
  const friendId = req.nextUrl.searchParams.get('friendId') || 'test-friend-001';
  const friendName = req.nextUrl.searchParams.get('friendName') || 'BananaFriend';

  try {
    if (action === 'track') {
      if (!code) return NextResponse.json({ error: 'Missing code param' }, { status: 400 });

      // Look up referrer by code
      const db = getAdminFirestore();
      const codeSnap = await db.collection('v2_referral_codes').doc(code).get();
      if (!codeSnap.exists) return NextResponse.json({ error: 'Code not found' }, { status: 404 });

      const referrerUserId = (codeSnap.data() as { userId: string }).userId;
      const result = await trackReferral(referrerUserId, friendId, friendName);
      return NextResponse.json({ action: 'track', result });
    }

    if (action === 'verify') {
      const result = await updateReferralRewards(friendId, 'verified');
      return NextResponse.json({ action: 'verify', result });
    }

    if (action === 'bought1') {
      const result = await updateReferralRewards(friendId, 'bought1');
      return NextResponse.json({ action: 'bought1', result });
    }

    if (action === 'bought10') {
      const result = await updateReferralRewards(friendId, 'bought10');
      return NextResponse.json({ action: 'bought10', result });
    }

    return NextResponse.json({
      usage: {
        track: '/api/debug/test-referral?action=track&code=BANANA-CK99-2026&friendId=test-friend-001&friendName=BananaFriend',
        verify: '/api/debug/test-referral?action=verify&friendId=test-friend-001',
        bought1: '/api/debug/test-referral?action=bought1&friendId=test-friend-001',
        bought10: '/api/debug/test-referral?action=bought10&friendId=test-friend-001',
      },
    });
  } catch (err) {
    console.error('[debug/test-referral]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
