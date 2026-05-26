import { NextRequest, NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { getUserNotifPrefs, setUserNotifPrefs, unlinkChannel } from '@/lib/notifications/prefs';
import type { ChannelId, EventPrefs } from '@/lib/notifications/types';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { logErrorEvent } from '@/lib/errorEvents';

/**
 * Audit OneSignal for any device tagged with the wallet that is actually
 * subscribed (notification_types > 0, valid identifier). Returns the
 * count — 0 means push wouldn't deliver anywhere even though the user
 * may have `channels.push: true` saved from a stale toggle attempt.
 *
 * Used by GET to keep the toggle truthful across page reloads: if 0,
 * we flip `channels.push: false` so the UI doesn't lie next time.
 */
async function countSubscribedPushDevices(wallet: string): Promise<{
  configured: boolean;
  count: number;
}> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return { configured: false, count: 0 };
  try {
    const res = await fetch(
      `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300`,
      { headers: { Authorization: `Key ${apiKey}` } },
    );
    if (!res.ok) return { configured: true, count: 0 };
    const body = (await res.json()) as {
      players?: Array<{
        notification_types?: number | null;
        invalid_identifier?: boolean;
        tags?: Record<string, string>;
      }>;
    };
    const count = (body.players || []).filter(
      (p) =>
        (p.tags?.walletAddress || '').toLowerCase() === wallet &&
        !p.invalid_identifier &&
        (p.notification_types ?? 0) > 0,
    ).length;
    return { configured: true, count };
  } catch {
    // Fail open — don't flip the toggle just because OneSignal is slow.
    return { configured: true, count: -1 };
  }
}

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
    let prefs = await getUserNotifPrefs(wallet);

    // Auto-audit push: if the user has channels.push:true saved but
    // OneSignal shows 0 subscribed devices tagged with this wallet, the
    // toggle would lie ("Connected ✓") while every push silently hits
    // recipients=0. Flip channels.push:false so the next page render
    // shows the truth, and log it so admin can see the heal happened.
    // count = -1 means OneSignal lookup itself failed — fail open
    // (leave prefs alone) rather than disable push on a transient.
    let pushAutoDisabled = false;
    if (prefs.channels?.push === true) {
      const audit = await countSubscribedPushDevices(wallet);
      if (audit.configured && audit.count === 0) {
        await setUserNotifPrefs(wallet, { channels: { push: false } });
        prefs = await getUserNotifPrefs(wallet);
        pushAutoDisabled = true;
        logErrorEvent({
          source: LOG_SOURCES.notifications.PUSH_ZERO_RECIPIENTS,
          message:
            'channels.push:true was set but OneSignal shows 0 subscribed devices for this wallet — auto-disabled push to keep the toggle truthful',
          actor: wallet,
          route: 'notifications/profile#GET',
          context: { autoHealed: true },
        });
      }
    }

    return NextResponse.json({ ok: true, prefs, pushAutoDisabled });
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
