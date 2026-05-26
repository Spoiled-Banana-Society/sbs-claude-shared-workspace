/**
 * POST /api/friends/accept   body: { otherWallet }
 *
 * Accept a pending friend request. Only the request RECIPIENT can accept —
 * the original sender gets a 403.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { acceptRequest } from '@/lib/friends';

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
    const friendship = await acceptRequest(user.walletAddress, other);
    if (!friendship) return NextResponse.json({ error: 'no pending request' }, { status: 404 });
    return NextResponse.json({ ok: true, friendship });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const status = /recipient/.test(msg) ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
