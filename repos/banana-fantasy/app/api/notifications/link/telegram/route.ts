import { NextRequest, NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { createTelegramLink } from '@/lib/notifications/telegramLink';

/**
 * GET /api/notifications/link/telegram
 * Privy-authed. Mints a one-time link token for the caller and returns the
 * Telegram deep link they should open to connect their account.
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

  if (!process.env.TELEGRAM_BOT_NAME) {
    return NextResponse.json({ error: 'Telegram not configured' }, { status: 503 });
  }

  const { url } = await createTelegramLink(wallet);
  return NextResponse.json({ ok: true, url });
}
