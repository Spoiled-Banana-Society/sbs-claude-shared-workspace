import { NextRequest, NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { createDiscordAuthUrl } from '@/lib/notifications/discordLink';

/**
 * GET /api/notifications/link/discord
 * Privy-authed. Mints a one-time OAuth `state` token for the caller and
 * returns the Discord authorize URL to open.
 */
export async function GET(req: NextRequest) {
  let wallet: string;
  try {
    const user = await getPrivyUser(req);
    wallet = (user.walletAddress || '').toLowerCase();
    if (!wallet) throw new Error('no wallet');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DISCORD_CLIENT_ID) {
    return NextResponse.json({ error: 'Discord not configured' }, { status: 503 });
  }

  const redirectUri = `${req.nextUrl.origin}/api/notifications/link/discord/callback`;
  const url = await createDiscordAuthUrl(wallet, redirectUri);
  if (!url) {
    return NextResponse.json({ error: 'Discord not configured' }, { status: 503 });
  }
  return NextResponse.json({ ok: true, url });
}
