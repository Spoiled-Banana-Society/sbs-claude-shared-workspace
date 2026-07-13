/**
 * GET /api/friends
 *
 * Returns { friends, incoming, outgoing } — three buckets of PublicUser.
 *   friends: accepted friendships
 *   incoming: pending requests sent TO me (I can accept/reject)
 *   outgoing: pending requests I SENT (I can cancel)
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { listForUser } from '@/lib/friends';
import { logger } from '@/lib/logger';

export async function GET(req: Request) {
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    const buckets = await listForUser(user.walletAddress);
    return NextResponse.json(buckets);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error('social.friends.unhandled', { err });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
