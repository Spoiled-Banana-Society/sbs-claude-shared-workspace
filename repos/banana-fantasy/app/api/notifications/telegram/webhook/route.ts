import { NextRequest, NextResponse } from 'next/server';
import { parseStartToken, consumeTelegramLink } from '@/lib/notifications/telegramLink';
import { logger } from '@/lib/logger';

/**
 * POST /api/notifications/telegram/webhook
 *
 * Receives Telegram Bot API updates. The only update we act on is
 * `/start <token>` from the account-linking deep link: we validate the
 * token and store the user's chat id on their notification prefs.
 *
 * Authenticated by the `X-Telegram-Bot-Api-Secret-Token` header, which
 * Telegram echoes from the value passed to `setWebhook`. Always replies
 * 200 so Telegram does not retry.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const update = await req.json().catch(() => null);
    const msg = update?.message;
    const text: string | undefined = msg?.text;
    const chatId: number | string | undefined = msg?.chat?.id;

    const token = parseStartToken(text);
    if (token && chatId != null) {
      const wallet = await consumeTelegramLink(token, chatId);
      await replyToChat(
        chatId,
        wallet
          ? '✅ Linked! You\'ll now get Banana Fantasy draft alerts here.'
          : '⚠️ That link is invalid or expired. Open the Connect button again from the app.',
      );
      logger.debug(`[telegram/webhook] start token consumed wallet=${wallet ?? 'none'}`);
    }
  } catch (err) {
    console.error('[telegram/webhook] Error:', err);
  }

  return NextResponse.json({ ok: true });
}

/** Best-effort reply to the user; failures are non-fatal. */
async function replyToChat(chatId: number | string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* ignore — linking already succeeded/failed regardless of the reply */
  }
}
