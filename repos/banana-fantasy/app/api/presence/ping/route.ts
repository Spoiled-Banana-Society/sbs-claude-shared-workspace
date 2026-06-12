/**
 * POST /api/presence/ping — heartbeat for the online dot (Boris 2026-06-11).
 *
 * Authed clients ping every ~45s while the tab is open; we stamp
 * RTDB `presence/{wallet} = ms`. Viewers subscribe to `/presence` and treat
 * lastSeen within 90s as online. Server-stamped (admin SDK) so nobody can
 * fake anyone else's presence; entries simply age out — no cleanup needed.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getAdminDatabase } from '@/lib/firebaseAdmin';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { walletAddress } = await getPrivyUser(req);
    if (!walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    await getAdminDatabase().ref(`presence/${walletAddress.toLowerCase()}`).set(Date.now());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
