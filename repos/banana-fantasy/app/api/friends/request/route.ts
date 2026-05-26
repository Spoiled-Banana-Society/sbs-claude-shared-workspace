/**
 * POST /api/friends/request   body: { targetWallet }
 *
 * Sends a friend request. If the target had already sent a pending request to
 * the caller, this auto-accepts (mutual yes). Idempotent for existing
 * accepted/pending-by-me cases.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { sendRequest } from '@/lib/friends';

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

  let body: { targetWallet?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const target = String(body.targetWallet || '');
  if (!WALLET_RE.test(target)) return NextResponse.json({ error: 'invalid targetWallet' }, { status: 400 });
  if (target.toLowerCase() === user.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'cannot friend self' }, { status: 400 });
  }

  try {
    const friendship = await sendRequest(user.walletAddress, target);
    return NextResponse.json({ ok: true, friendship });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
