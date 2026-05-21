import { NextRequest, NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { getUserNotifPrefs, setUserNotifPrefs } from '@/lib/notifications/prefs';
import type { ChannelId, EventPrefs } from '@/lib/notifications/types';

const EDITABLE_CHANNELS: ChannelId[] = ['push', 'email', 'telegram', 'discord'];
const EDITABLE_EVENTS: (keyof EventPrefs)[] = ['draftFilled', 'pickSlow', 'pickFast'];

/** Resolve the authenticated wallet, or null if unauthenticated. */
async function authWallet(req: NextRequest): Promise<string | null> {
  try {
    const user = await getPrivyUser(req);
    return (user.walletAddress || '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/notifications/profile
 * Returns the authenticated user's notification preferences.
 */
export async function GET(req: NextRequest) {
  const wallet = await authWallet(req);
  if (!wallet) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const prefs = await getUserNotifPrefs(wallet);
  return NextResponse.json({ ok: true, prefs });
}

/**
 * PUT /api/notifications/profile
 * Updates the caller's own channel toggles and email address. Linked
 * account ids (telegramChatId, discordId) are NOT editable here — they are
 * set only by the Telegram/Discord linking flows.
 *
 * Body: {
 *   channels?: Partial<Record<ChannelId, boolean>>,
 *   events?: Partial<Record<keyof EventPrefs, boolean>>,
 *   email?: string,
 * }
 */
export async function PUT(req: NextRequest) {
  const wallet = await authWallet(req);
  if (!wallet) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: {
    channels?: Partial<Record<ChannelId, boolean>>;
    events?: EventPrefs;
    email?: string;
  } = {};

  if (body.channels && typeof body.channels === 'object') {
    const channels: Partial<Record<ChannelId, boolean>> = {};
    for (const id of EDITABLE_CHANNELS) {
      if (id in body.channels) channels[id] = !!body.channels[id];
    }
    patch.channels = channels;
  }
  if (body.events && typeof body.events === 'object') {
    const events: EventPrefs = {};
    for (const id of EDITABLE_EVENTS) {
      if (id in body.events) events[id] = !!body.events[id];
    }
    patch.events = events;
  }
  if (typeof body.email === 'string') {
    patch.email = body.email.trim();
  }

  await setUserNotifPrefs(wallet, patch);
  const prefs = await getUserNotifPrefs(wallet);
  return NextResponse.json({ ok: true, prefs });
}
