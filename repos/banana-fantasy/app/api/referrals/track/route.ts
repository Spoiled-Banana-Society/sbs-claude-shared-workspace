import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { trackReferral } from '@/lib/db';

export const dynamic = 'force-dynamic';

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

    // We need to scan referralsByUser to find who owns this code.
    // Load the DB directly for this lookup.
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const isVercel = !!process.env.VERCEL;
    const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(process.cwd(), 'data');
    const DB_PATH = path.join(DATA_DIR, 'db.json');

    let dbData;
    try {
      const raw = await fs.readFile(DB_PATH, 'utf8');
      dbData = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    // Find referrer by code
    let referrerUserId: string | null = null;
    for (const [userId, ref] of Object.entries(dbData.referralsByUser ?? {})) {
      if ((ref as { code: string }).code === referrerCode) {
        referrerUserId = userId;
        break;
      }
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
