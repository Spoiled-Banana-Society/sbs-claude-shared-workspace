/**
 * GET /api/users/roster
 *
 * The All Users directory: every user who has logged into the new site
 * (new or returning), with fully-resolved display names + pfps (default
 * Banana handle or their edited name — never a raw wallet). Cached
 * server-side for 10 minutes; auth required so it isn't a public scrape.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getUserRoster } from '@/lib/userRoster';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const users = await getUserRoster();
    return NextResponse.json({ users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
