/**
 * POST /api/friends/remove   body: { otherWallet }
 *
 * Removes the friendship doc. Works for any state:
 *  - accepted → unfriend
 *  - pending (incoming) → reject
 *  - pending (outgoing) → cancel
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { rejectOrRemove } from '@/lib/friends';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;

export async function POST(req: Request) {
  let user: { userId: string; walletAddress: string | null };
  try {
    user = await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  let body: { otherWallet?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const other = String(body.otherWallet || '');
  if (!WALLET_RE.test(other)) return NextResponse.json({ error: 'invalid otherWallet' }, { status: 400 });

  try {
    await rejectOrRemove(user.walletAddress, other);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
