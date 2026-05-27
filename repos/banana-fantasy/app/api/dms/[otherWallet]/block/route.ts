/**
 * POST   /api/dms/{otherWallet}/block   → block this user (caller hides them)
 * DELETE /api/dms/{otherWallet}/block   → unblock this user
 *
 * Blocking is per-direction: each user maintains their own blocklist at
 * dm_blocks/{theirWallet}. sendMessage rejects when EITHER side has
 * blocked the other, so a one-way block is enough to stop the flow.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { blockUser, unblockUser } from '@/lib/dms';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;

async function getCaller(req: Request) {
  const user = await getPrivyUser(req);
  if (!user.walletAddress) throw new ApiError(400, 'wallet required');
  return user.walletAddress;
}

export async function POST(
  req: Request,
  { params }: { params: { otherWallet: string } },
) {
  try {
    const myWallet = await getCaller(req);
    const otherWallet = params.otherWallet;
    if (!WALLET_RE.test(otherWallet)) return NextResponse.json({ error: 'invalid otherWallet' }, { status: 400 });
    if (otherWallet.toLowerCase() === myWallet.toLowerCase()) {
      return NextResponse.json({ error: 'cannot block self' }, { status: 400 });
    }
    await blockUser(myWallet, otherWallet);
    return NextResponse.json({ ok: true, blocked: true });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { otherWallet: string } },
) {
  try {
    const myWallet = await getCaller(req);
    const otherWallet = params.otherWallet;
    if (!WALLET_RE.test(otherWallet)) return NextResponse.json({ error: 'invalid otherWallet' }, { status: 400 });
    await unblockUser(myWallet, otherWallet);
    return NextResponse.json({ ok: true, blocked: false });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
