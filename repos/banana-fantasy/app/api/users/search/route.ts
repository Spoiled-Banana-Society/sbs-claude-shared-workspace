/**
 * GET /api/users/search?q=...
 *
 * User discovery for friend-add. Matches an exact wallet address OR an exact
 * username (case-insensitive across a few candidate forms). Excludes the
 * caller from results.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { searchUsers } from '@/lib/friends';

export async function GET(req: Request) {
  let user: { userId: string; walletAddress: string | null };
  try {
    user = await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ users: [] });
  if (q.length > 60) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  try {
    const users = await searchUsers(q, user.walletAddress, 10);
    return NextResponse.json({ users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
