import { NextRequest, NextResponse } from 'next/server';
import { consumeDiscordState, linkDiscordAccount } from '@/lib/notifications/discordLink';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * GET /api/notifications/link/discord/callback?code=...&state=...
 *
 * Discord OAuth redirect target. Validates the `state` token, exchanges
 * the `code` for the user's Discord id, links it, then redirects the user
 * back to the notification settings page with a status flag.
 *
 * Every failure path **logs to the admin Logs tab** AND carries a `reason`
 * in the redirect URL. So a "white screen / nothing in admin" silent-error
 * situation can't happen again — both the user and the admin always see
 * exactly which step broke.
 */
export async function GET(req: NextRequest) {
  const settingsUrl = new URL('/profile', req.nextUrl.origin);
  settingsUrl.searchParams.set('tab', 'notifications');

  const failWith = (reason: string, actor?: string, context?: Record<string, unknown>) => {
    logger.error(LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED, {
      err: `discord link callback failed: ${reason}`,
      route: 'notifications/link/discord/callback',
      actor,
      context,
    });
    settingsUrl.searchParams.set('discord', 'error');
    settingsUrl.searchParams.set('reason', reason);
    return NextResponse.redirect(settingsUrl);
  };

  try {
    const code = req.nextUrl.searchParams.get('code') || '';
    const state = req.nextUrl.searchParams.get('state') || '';
    // Discord puts ?error=access_denied&error_description=... on the
    // redirect when the user cancels or denies the consent screen.
    const oauthError = req.nextUrl.searchParams.get('error');
    const oauthErrorDesc = req.nextUrl.searchParams.get('error_description') || '';

    if (oauthError) {
      return failWith('oauth_denied_or_error', undefined, { oauthError, oauthErrorDesc });
    }
    if (!code || !state) {
      return failWith('missing_code_or_state', undefined, {
        hasCode: !!code,
        hasState: !!state,
      });
    }

    const wallet = await consumeDiscordState(state);
    if (!wallet) {
      return failWith('invalid_or_expired_state');
    }

    const redirectUri = `${req.nextUrl.origin}/api/notifications/link/discord/callback`;
    const discordId = await linkDiscordAccount(wallet, code, redirectUri);
    if (!discordId) {
      // Token exchange or /users/@me lookup failed (swallowed inside
      // linkDiscordAccount). Surface it loudly here, with the wallet.
      return failWith('token_exchange_or_user_lookup_failed', wallet);
    }

    logger.debug(`[link/discord/callback] wallet=${wallet} linked=${discordId}`);
    settingsUrl.searchParams.set('discord', 'linked');
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    // Any unhandled throw still produces a clean redirect + a loud log,
    // not a 500 / white screen.
    logger.error(LOG_SOURCES.notifications.CHANNEL_CONNECT_FAILED, {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/link/discord/callback',
      context: { reason: 'unhandled_exception' },
    });
    settingsUrl.searchParams.set('discord', 'error');
    settingsUrl.searchParams.set('reason', 'exception');
    return NextResponse.redirect(settingsUrl);
  }
}
