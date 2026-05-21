import { NextRequest, NextResponse } from 'next/server';
import { consumeDiscordState, linkDiscordAccount } from '@/lib/notifications/discordLink';
import { logger } from '@/lib/logger';

/**
 * GET /api/notifications/link/discord/callback?code=...&state=...
 *
 * Discord OAuth redirect target. Validates the `state` token, exchanges the
 * `code` for the user's Discord id, links it, then redirects the user back
 * to the notification settings page with a status flag.
 */
export async function GET(req: NextRequest) {
  const settingsUrl = new URL('/notifications/settings', req.nextUrl.origin);
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';

  if (!code || !state) {
    settingsUrl.searchParams.set('discord', 'error');
    return NextResponse.redirect(settingsUrl);
  }

  const wallet = await consumeDiscordState(state);
  if (!wallet) {
    settingsUrl.searchParams.set('discord', 'error');
    return NextResponse.redirect(settingsUrl);
  }

  const redirectUri = `${req.nextUrl.origin}/api/notifications/link/discord/callback`;
  const discordId = await linkDiscordAccount(wallet, code, redirectUri);

  logger.debug(`[link/discord/callback] wallet=${wallet} linked=${discordId ?? 'none'}`);
  settingsUrl.searchParams.set('discord', discordId ? 'linked' : 'error');
  return NextResponse.redirect(settingsUrl);
}
