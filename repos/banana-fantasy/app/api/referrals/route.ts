import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/referrals?userId=xxx — Get referral stats for a user
 * POST /api/referrals — Generate a referral code for a user
 */

// In-memory store (replaced by Firestore in production)
const referralStore: Record<string, {
  code: string;
  link: string;
  userId: string;
  createdAt: string;
  clicks: number;
  signups: number;
  bonusesEarned: number;
  referrals: Array<{
    userId: string;
    username: string;
    joinedAt: string;
    bonusCredited: boolean;
  }>;
}> = {};

function generateCode(walletOrName: string): string {
  const base = walletOrName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BANANA-${base}-${suffix}`;
}

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.general);
  if (rl) return rl;

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const data = referralStore[userId];
  if (!data) {
    return NextResponse.json({
      userId,
      code: null,
      link: null,
      clicks: 0,
      signups: 0,
      bonusesEarned: 0,
      referrals: [],
    });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RATE_LIMITS.general);
  if (rl) return rl;

  try {
    const body = await req.json();
    const { userId, username } = body;
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    // Return existing code if already generated
    if (referralStore[userId]) {
      return NextResponse.json(referralStore[userId]);
    }

    const code = generateCode(username || userId);
    const link = `https://sbsfantasy.com/ref/${code}`;

    referralStore[userId] = {
      code,
      link,
      userId,
      createdAt: new Date().toISOString(),
      clicks: 0,
      signups: 0,
      bonusesEarned: 0,
      referrals: [],
    };

    return NextResponse.json(referralStore[userId], { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
