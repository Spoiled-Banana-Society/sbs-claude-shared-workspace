/**
 * Global chat — list + send messages.
 *
 *   GET  /api/global-chat   → last 200 messages, oldest→newest
 *   POST /api/global-chat   → send (validates not muted)
 *
 * GET is public — anyone can read the room. POST requires a Privy JWT so we
 * can verify the sender and check the mute list.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getActiveMute, listMessages, postMessage } from '@/lib/globalChat';
import { logger } from '@/lib/logger';

const TEXT_MAX = 500;

export async function GET() {
  try {
    const messages = await listMessages();
    return NextResponse.json({ messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'read failed';
    logger.error('social.global_chat.unhandled', { err, context: { op: 'read' } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let user: { userId: string; walletAddress: string | null };
  try {
    user = await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!user.walletAddress) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 });
  }

  let body: { username?: string; text?: string; pfpUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const text = String(body.text || '').trim().slice(0, TEXT_MAX);
  if (!text) return NextResponse.json({ error: 'empty text' }, { status: 400 });

  // Server-side mute enforcement. The client also blocks input but never trust
  // it — a hand-crafted POST from a muted user must still be rejected.
  const mute = await getActiveMute(user.walletAddress);
  if (mute) {
    return NextResponse.json({
      error: 'muted',
      mute: {
        expiresAt: mute.expiresAt,
        reason: mute.reason,
      },
    }, { status: 403 });
  }

  const username = String(body.username || '').slice(0, 60) || user.walletAddress.slice(0, 8);
  const pfpUrl = typeof body.pfpUrl === 'string' ? body.pfpUrl.slice(0, 500) : undefined;

  try {
    const { id } = await postMessage({
      walletAddress: user.walletAddress,
      username,
      pfpUrl,
      text,
    });
    // Broadcast ping: ONE RTDB write — every open #general refetches in
    // ~300ms instead of waiting out the 2s poll (Boris 2026-06-11).
    try {
      const { getAdminDatabase } = await import('@/lib/firebaseAdmin');
      const { runInBackground } = await import('@/lib/serverBackground');
      runInBackground('global-chat-ping', getAdminDatabase().ref('globalChatPing').set({ at: Date.now(), id }));
    } catch { /* ping is best-effort; poll remains the fallback */ }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'write failed';
    if (!(err instanceof ApiError)) logger.error('social.global_chat.unhandled', { err, context: { op: 'write' } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
