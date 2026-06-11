/**
 * POST /api/crisp/webhook — Crisp Web Hooks receiver (Boris 2026-06-11).
 *
 * Wire-up (one-time, in the Crisp dashboard): Settings → Workspace Settings →
 * Web Hooks → add `https://banana-fantasy-sbs.vercel.app/api/crisp/webhook`
 * with events `message:send` + `message:received`. Optionally set the signing
 * secret as CRISP_WEBHOOK_SECRET in Vercel for HMAC verification.
 *
 * What it does, both directions, realtime:
 *  • Visitor message (`message:send`) → instant bell noti to every ADMIN
 *    wallet: who wrote + what they said → links to Admin → Support.
 *  • Team reply (`message:received` from operator) → instant bell noti to
 *    THAT user's wallet ("SBS Team replied") → opens the Crisp chat.
 *    Wallet comes from the session data the widget stamps at login.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminWalletAllowlist } from '@/lib/adminAllowlist';
import { getConversationMeta } from '@/lib/crispApi';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';

const WEBSITE_ID = 'ed386428-a6f2-435a-a3e1-043f0a078093';

interface CrispWebhookPayload {
  event?: string;
  data?: {
    website_id?: string;
    session_id?: string;
    type?: string;
    from?: 'user' | 'operator';
    origin?: string;
    content?: unknown;
    user?: { nickname?: string };
  };
  timestamp?: number;
}

/** Session-data wallet: stamped as 'addr-0x…' (string-safe — Crisp
 *  number-coerces bare hex). Tolerates legacy bare strings; rejects the
 *  numeric junk Crisp made of old stamps. */
function parseStampedWallet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = (raw.startsWith('addr-') ? raw.slice(5) : raw).toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(v) ? v : null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return '[attachment]';
}

export async function POST(req: Request) {
  const raw = await req.text();

  // HMAC verification when the signing secret is configured.
  const secret = process.env.CRISP_WEBHOOK_SECRET?.trim();
  if (secret) {
    const sig = req.headers.get('x-crisp-signature') || '';
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!sig || !crypto.timingSafeEqual(Buffer.from(sig.padEnd(expected.length).slice(0, expected.length)), Buffer.from(expected))) {
      return NextResponse.json({ error: 'bad signature' }, { status: 401 });
    }
  }

  let payload: CrispWebhookPayload;
  try { payload = JSON.parse(raw) as CrispWebhookPayload; }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const event = payload.event ?? '';
  const d = payload.data ?? {};
  if (d.website_id && d.website_id !== WEBSITE_ID) {
    return NextResponse.json({ error: 'unknown website' }, { status: 403 });
  }
  const sessionId = d.session_id ?? '';
  const fingerprint = `${sessionId}-${payload.timestamp ?? ''}`.slice(-48);

  try {
    if (event === 'message:send' && d.from === 'user') {
      // Visitor wrote in — resolve who, then ping every admin instantly.
      const meta = sessionId ? await getConversationMeta(sessionId).catch(() => null) : null;
      const wallet = parseStampedWallet(meta?.data?.wallet);
      const who = d.user?.nickname || meta?.nickname || (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'A user');
      const text = textOf(d.content);
      await Promise.all(getAdminWalletAllowlist().map((admin) =>
        createNotification(admin, {
          type: 'system',
          title: 'Support: New Message',
          message: `${who}: ${text.slice(0, 140)}`,
          link: '/admin?tab=support',
          dedupeKey: `crisp-in-${fingerprint}`,
          icon: 'msg',
        }).catch(() => {}),
      ));
      logger.info('crisp.webhook.visitor_message', { context: { sessionId, who } });
    } else if (event === 'message:received' && d.from === 'operator') {
      // Team replied — bell the user so they come back to the chat.
      const meta = sessionId ? await getConversationMeta(sessionId).catch(() => null) : null;
      const wallet = parseStampedWallet(meta?.data?.wallet);
      if (wallet && /^0x[0-9a-f]{40}$/.test(wallet)) {
        await createNotification(wallet, {
          type: 'message_received',
          title: 'SBS Team Replied',
          message: 'Support replied to your chat — tap to open it.',
          link: '/?support=open',
          dedupeKey: `crisp-out-${fingerprint}`,
          icon: 'msg',
        }).catch(() => {});
        logger.info('crisp.webhook.team_reply_notified', { context: { sessionId, wallet } });
      } else {
        logger.warn('crisp.webhook.team_reply_no_wallet', { context: { sessionId } });
      }
    }
  } catch (err) {
    logger.error('crisp.webhook.failed', { err: err instanceof Error ? err : String(err), context: { event, sessionId } });
  }

  // Always 200 fast — Crisp retries/disables noisy hooks.
  return NextResponse.json({ ok: true });
}
