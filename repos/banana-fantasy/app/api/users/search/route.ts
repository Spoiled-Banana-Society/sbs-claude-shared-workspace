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
import { searchRoster } from '@/lib/userRoster';

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
    // Two sources merged: the stored-username index (fast, exact) + the
    // resolved roster (covers wallet-derived Banana defaults and legacy Go
    // names that aren't stored in v2_users — without it, most users were
    // unfindable because their doc has no username field at all).
    const [indexed, fromRoster] = await Promise.all([
      searchUsers(q, user.walletAddress, 10),
      searchRoster(q, user.walletAddress, 10).catch(() => []),
    ]);
    const seen = new Set(indexed.map((u) => u.walletAddress.toLowerCase()));
    const users = [
      ...indexed,
      ...fromRoster
        .filter((u) => !seen.has(u.walletAddress))
        .map((u) => ({ walletAddress: u.walletAddress, username: u.username, profilePicture: u.profilePicture ?? undefined })),
    ].slice(0, 10);
    return NextResponse.json({ users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
