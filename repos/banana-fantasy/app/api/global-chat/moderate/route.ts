/**
 * POST /api/global-chat/moderate
 *
 * Admin-only moderation actions. One endpoint handles both mute and
 * delete-recent so a single "Timeout user" form on the client can do both
 * atomically (mirroring Discord, where the Timeout dialog has a mute
 * duration AND a "delete previous messages" picker).
 *
 * Body:
 *   {
 *     action: 'mute' | 'unmute' | 'delete_recent',
 *     targetWallet: string,
 *     // For 'mute':
 *     durationMs?: number,     // 0 = permanent
 *     reason?: string,
 *     // For 'delete_recent':
 *     lookbackMs?: number,     // 0 = all messages from user, >0 = within window
 *   }
 *
 * The Discord-style "Timeout" UI on the client posts twice when needed:
 * once with action=mute, once with action=delete_recent. Keeping them
 * separate here keeps the endpoint composable.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { ApiError } from '@/lib/api/errors';
import {
  clearMute,
  deleteRecentMessagesFromUser,
  logModerationAction,
  setMute,
} from '@/lib/globalChat';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;

export async function POST(req: Request) {
  let admin: { userId: string; walletAddress: string | null };
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: {
    action?: string;
    targetWallet?: string;
    durationMs?: number;
    reason?: string;
    lookbackMs?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const action = String(body.action || '');
  const targetWallet = String(body.targetWallet || '');
  if (!WALLET_RE.test(targetWallet)) {
    return NextResponse.json({ error: 'invalid targetWallet' }, { status: 400 });
  }

  try {
    if (action === 'mute') {
      const durationMs = Math.max(0, Number(body.durationMs ?? 0));
      const mute = await setMute({
        targetWallet,
        durationMs,
        mutedBy: admin.walletAddress || '',
        reason: body.reason,
      });
      await logModerationAction({
        action: 'mute',
        adminWallet: admin.walletAddress || '',
        targetWallet,
        meta: { durationMs, expiresAt: mute.expiresAt, reason: body.reason },
      });
      return NextResponse.json({ ok: true, mute });
    }

    if (action === 'unmute') {
      await clearMute(targetWallet);
      await logModerationAction({
        action: 'unmute',
        adminWallet: admin.walletAddress || '',
        targetWallet,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_recent') {
      const lookbackMs = Math.max(0, Number(body.lookbackMs ?? 0));
      const deleted = await deleteRecentMessagesFromUser(targetWallet, lookbackMs);
      await logModerationAction({
        action: 'delete_recent',
        adminWallet: admin.walletAddress || '',
        targetWallet,
        meta: { lookbackMs, deletedCount: deleted },
      });
      return NextResponse.json({ ok: true, deleted });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'moderation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
