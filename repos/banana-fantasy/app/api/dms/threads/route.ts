/**
 * GET /api/dms/threads
 *
 * Returns all DM threads for the caller, separated into:
 *   - messages: status === 'accepted' (active conversations)
 *   - requests: status === 'pending' AND I'm the recipient (need to approve)
 *   - sent:     status === 'pending' AND I'm the originator (waiting on them)
 *
 * Each thread carries lastMessagePreview + lastMessageAt for inbox display,
 * plus an unreadCount computed from lastReadAt vs lastMessageAt.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { listThreadsForUser, type DmThread } from '@/lib/dms';
import { getPublicUsers, type PublicUser } from '@/lib/friends';

interface ThreadView {
  threadId: string;
  other: PublicUser;
  status: 'pending' | 'accepted';
  startedBy: string;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
}

export async function GET(req: Request) {
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    const myWallet = user.walletAddress.toLowerCase();

    const threads = await listThreadsForUser(myWallet);
    const otherWallets = threads.map((t) => (t.participants[0] === myWallet ? t.participants[1] : t.participants[0]));
    const profileMap = await getPublicUsers(otherWallets);

    const toView = (t: DmThread): ThreadView => {
      const other = t.participants[0] === myWallet ? t.participants[1] : t.participants[0];
      const profile = profileMap.get(other) ?? { walletAddress: other, username: other.slice(0, 8) };
      const myRead = t.lastReadAt?.[myWallet] ?? 0;
      // Unread: thread has new messages I haven't seen. If the latest message
      // is mine (rare but possible), unreadCount is 0.
      const unread = t.lastMessageAt > myRead && t.startedBy !== myWallet ? 1 : 0;
      return {
        threadId: t.id,
        other: profile,
        status: t.status,
        startedBy: t.startedBy,
        lastMessageAt: t.lastMessageAt,
        lastMessagePreview: t.lastMessagePreview,
        unreadCount: unread,
      };
    };

    const messages: ThreadView[] = [];
    const requests: ThreadView[] = [];
    const sent: ThreadView[] = [];
    for (const t of threads) {
      const view = toView(t);
      if (t.status === 'accepted') messages.push(view);
      else if (t.startedBy === myWallet) sent.push(view);
      else requests.push(view);
    }

    return NextResponse.json({ messages, requests, sent });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
