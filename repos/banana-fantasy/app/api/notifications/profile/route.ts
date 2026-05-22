import { NextRequest, NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { getUserNotifPrefs, setUserNotifPrefs, unlinkChannel } from '@/lib/notifications/prefs';
import type { ChannelId, EventPrefs } from '@/lib/notifications/types';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

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
  try {
    const prefs = await getUserNotifPrefs(wallet);
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    // Surface in the admin Logs tab with the wallet attached, so a tester
    // who reports "my settings won't load" can be pinpointed.
    logger.error(LOG_SOURCES.notifications.SETTINGS_READ_FAILED, {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/profile#GET',
      actor: wallet,
    });
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }
}

/**
 * PUT /api/notifications/profile
 * Updates the caller's own channel toggles and email address. Linked
 * account ids (telegramChatId, discordId) can't be *set* here — only the
 * Telegram/Discord link flows do that — but `unlink` may *clear* one,
 * which is always safe (you can only disconnect your own account).
 *
 * Body: {
 *   channels?: Partial<Record<ChannelId, boolean>>,
 *   events?: Partial<Record<keyof EventPrefs, boolean>>,
 *   email?: string,
 *   unlink?: 'telegram' | 'discord',
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
  const unlink: 'telegram' | 'discord' | null =
    body.unlink === 'telegram' || body.unlink === 'discord' ? body.unlink : null;

  try {
    if (unlink) await unlinkChannel(wallet, unlink);
    await setUserNotifPrefs(wallet, patch);
    const prefs = await getUserNotifPrefs(wallet);
    logger.debug(
      `[notifications/profile] saved wallet=${wallet} keys=${Object.keys(patch).join(',') || 'none'}${unlink ? ` unlink=${unlink}` : ''}`,
    );
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    // A failed save means the user's toggle silently didn't stick — log
    // it so the admin Logs tab shows which user and which keys broke.
    logger.error(LOG_SOURCES.notifications.SETTINGS_SAVE_FAILED, {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/profile#PUT',
      actor: wallet,
      context: { patchKeys: Object.keys(patch) },
    });
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
