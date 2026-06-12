/**
 * GET  /api/dms/{otherWallet}        → list messages in this thread + permission state
 * POST /api/dms/{otherWallet}        → send a message (handles request / accepted flows)
 *
 * Wallet path param is the OTHER party's wallet; the calling wallet comes
 * from the Privy JWT. Composite thread id is computed server-side so the
 * client can never address the wrong thread.
 */

export const dynamic = 'force-dynamic';

import { pushStreamEventBg } from '@/lib/userEventStream';

import { NextResponse } from 'next/server';
import { runInBackground } from '@/lib/serverBackground';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import {
  getBlockState,
  getThread,
  listMessages,
  markThreadRead,
  permissionFor,
  rejectThread,
  sendMessage,
  threadId,
} from '@/lib/dms';
import { getPublicUsers } from '@/lib/friends';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;
const TEXT_MAX = 2000;

export async function GET(
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
  if (otherWallet.toLowerCase() === user.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'no self DM' }, { status: 400 });
  }

  try {
    const tid = threadId(user.walletAddress, otherWallet);
    const [thread, messages, perm, profileMap, block] = await Promise.all([
      getThread(user.walletAddress, otherWallet),
      listMessages(tid),
      permissionFor(user.walletAddress, otherWallet),
      getPublicUsers([otherWallet]),
      getBlockState(user.walletAddress, otherWallet),
    ]);
    const otherProfile = profileMap.get(otherWallet.toLowerCase()) ?? {
      walletAddress: otherWallet.toLowerCase(),
      username: otherWallet.slice(0, 8),
    };

    // Mark read on every GET — opening the thread counts as reading it.
    // waitUntil-backed: a detached promise dies with the frozen lambda and
    // the thread incorrectly stays unread.
    if (thread) {
      runInBackground('dm.mark-read', markThreadRead(user.walletAddress, otherWallet));
    }

    return NextResponse.json({
      threadId: tid,
      thread,
      messages,
      permission: perm,
      other: otherProfile,
      block,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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

  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const text = String(body.text || '').slice(0, TEXT_MAX);
  if (!text.trim()) return NextResponse.json({ error: 'empty text' }, { status: 400 });

  try {
    const { thread, message } = await sendMessage({
      senderWallet: user.walletAddress,
      recipientWallet: otherWallet,
      text,
    });
    // Instant ping → recipient's inbox/thread/noti surfaces refetch in
    // ~300ms instead of waiting out the 15s poll (Boris 2026-06-11:
    // all chat must be realtime, both directions).
    pushStreamEventBg(otherWallet.toLowerCase(), 'notification', { source: 'dm-message' });
    return NextResponse.json({ ok: true, thread, message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const status = /pending|self|empty|blocked/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE /api/dms/{otherWallet} — recipient rejects a pending DM request.
 * Only valid on pending threads where the caller is the recipient.
 */
export async function DELETE(
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
    await rejectThread(user.walletAddress, otherWallet);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const status = /recipient|accepted/.test(msg) ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
