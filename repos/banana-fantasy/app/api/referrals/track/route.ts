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

    // ELIGIBILITY IS ENFORCED, not informational (Boris 2026-07-13 — the
    // RisBrian/Vertig0 case: a returning player got linked and sat in the
    // referrer's history as eternally-"pending" rows that could never pay).
    // A referral only counts for a NEW player: (a) has NOT drafted yet, and
    // (b) is NOT a returning player from a previous season. Ineligible users
    // are NOT linked at all — nothing enters the referrer's history.
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
    } catch { /* default eligible:true on read error — never block a real new user */ }

    if (!eligible) {
      // Tell the REFERRER what happened with ONE clean bell (deduped per
      // referred user) — instead of a history row that could never pay
      // (Boris 2026-07-13). Awaited so the Vercel lambda can't drop it.
      try {
        const { createNotification } = await import('@/lib/queueNotifications');
        const name = referredUsername && !/^user-?[0-9a-fx]/i.test(String(referredUsername).trim())
          && !/^0x[0-9a-f]{6,}/i.test(String(referredUsername).trim())
          ? String(referredUsername).trim()
          : 'Someone';
        await createNotification(referrerUserId, {
          type: 'promo',
          title: 'Referral link used — not a new player',
          message: `${name} used your referral link, but they’re not a new player. Referral rewards only come from NEW users — share your link with friends who haven’t played yet.`,
          link: '/promos?promo=3',
          dedupeKey: `referral-ineligible-${referredUserId}`,
          icon: 'users',
        });
      } catch { /* best-effort — never block the response on the bell */ }
      return NextResponse.json({
        success: false,
        eligible: false,
        timestamp: new Date().toISOString(),
      });
    }

    const result = await trackReferral(
      referrerUserId,
      referredUserId,
      referredUsername || `User${referredUserId}`,
    );

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
