/**
 * DELETE /api/global-chat/{messageId}
 *
 * Admin-only — removes a single message from the global chat. Used by the
 * three-dot menu on a message bubble.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { ApiError } from '@/lib/api/errors';
import { deleteMessage, logModerationAction } from '@/lib/globalChat';

export async function DELETE(
  req: Request,
  { params }: { params: { messageId: string } },
) {
  let admin: { userId: string; walletAddress: string | null };
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { messageId } = params;
  if (!messageId || !/^[a-zA-Z0-9_-]{6,64}$/.test(messageId)) {
    return NextResponse.json({ error: 'invalid messageId' }, { status: 400 });
  }

  try {
    await deleteMessage(messageId);
    await logModerationAction({
      action: 'delete_message',
      adminWallet: admin.walletAddress || '',
      meta: { messageId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'delete failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
