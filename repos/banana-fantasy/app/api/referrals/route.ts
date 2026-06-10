import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ensureNamedReferralCode } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/referrals?userId=xxx[&username=Name] — referral code + live stats
 * POST /api/referrals { userId, username }       — mint (or refresh) the code
 *
 * Firestore-backed (was an in-memory mock that lost data on every lambda
 * recycle). Source of truth:
 *  - users/{id}/metadata/referral             → current code
 *  - v2_referral_codes/{CODE}                 → reverse lookup + click counter
 *  - users/{id}/promos (type 'referral')      → referralHistory (signups/rewards)
 * Codes are NAME-based (…/r/BorisV) via ensureNamedReferralCode.
 */

const REFERRAL_CODES_COLLECTION = 'v2_referral_codes';
const SITE_URL = 'https://banana-fantasy-sbs.vercel.app';

type RewardState = string;
interface HistoryEntry {
  username?: string;
  referredUserId?: string;
  dateJoined?: string;
  status?: string;
  rewards?: Record<string, RewardState>;
}

async function buildStats(userId: string, username?: string | null) {
  const db = getAdminFirestore();

  let code: string | null = null;
  if (username) {
    // Keeps the code in sync with their current display name.
    code = (await ensureNamedReferralCode(userId, username)).code;
  } else {
    const meta = await db.collection('v2_users').doc(userId).collection('metadata').doc('referral').get();
    code = (meta.data()?.code as string | undefined) ?? null;
  }

  if (!code) {
    return { userId, code: null, link: null, clicks: 0, signups: 0, bonusesEarned: 0, referrals: [] };
  }

  const [codeSnap, promosSnap] = await Promise.all([
    db.collection(REFERRAL_CODES_COLLECTION).doc(code.toUpperCase()).get(),
    db.collection('v2_users').doc(userId).collection('promos').where('type', '==', 'referral').limit(1).get(),
  ]);

  const clicks = Number(codeSnap.data()?.clicks ?? 0);
  const history: HistoryEntry[] = promosSnap.empty
    ? []
    : ((promosSnap.docs[0].data()?.modalContent?.referralHistory as HistoryEntry[] | undefined) ?? []);

  const referrals = history.map((e) => ({
    userId: e.referredUserId ?? '',
    username: e.username ?? 'Friend',
    joinedAt: e.dateJoined ?? '',
    bonusCredited: Object.values(e.rewards ?? {}).some((v) => v === 'earned'),
  }));

  return {
    userId,
    code,
    link: `${SITE_URL}/r/${code}`,
    clicks,
    signups: referrals.length,
    bonusesEarned: referrals.filter((r) => r.bonusCredited).length,
    referrals,
  };
}

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.general);
  if (rl) return rl;
  if (!isFirestoreConfigured()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  const username = req.nextUrl.searchParams.get('username');

  try {
    return NextResponse.json(await buildStats(userId, username));
  } catch (err) {
    console.error('[referrals] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.general);
  if (rl) return rl;
  if (!isFirestoreConfigured()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  try {
    const body = await req.json();
    const { userId, username } = body as { userId?: string; username?: string };
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    await ensureNamedReferralCode(userId, username);
    return NextResponse.json(await buildStats(userId, null), { status: 201 });
  } catch (err) {
    console.error('[referrals] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
