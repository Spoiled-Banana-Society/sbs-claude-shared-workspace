/**
 * POST /api/dms/{otherWallet}/accept
 *
 * Recipient approves a pending DM request. Moves the thread from
 * Requests → Messages. Only the recipient can call this; the originator
 * gets a 403.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { acceptThread } from '@/lib/dms';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;

export async function POST(
  req: Request,
  { params }: { params: { otherWallet: string } },
) {
  let user: { userId: string; walletAddress: string | null };
  try {
    user = await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  const otherWallet = params.otherWallet;
  if (!WALLET_RE.test(otherWallet)) {
    return NextResponse.json({ error: 'invalid otherWallet' }, { status: 400 });
  }

  try {
    const thread = await acceptThread(user.walletAddress, otherWallet);
    if (!thread) return NextResponse.json({ error: 'no thread' }, { status: 404 });
    return NextResponse.json({ ok: true, thread });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const status = /recipient/.test(msg) ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
