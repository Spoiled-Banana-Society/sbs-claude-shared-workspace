/**
 * The four notification channel senders.
 *
 * Every sender implements the same `ChannelSender` signature and follows
 * the same contract:
 *   1. self-skip if the channel is toggled off,
 *   2. self-skip if the user hasn't linked the required contact,
 *   3. self-skip if the channel's env var is unset,
 *   4. otherwise send, and never throw — failures come back as a value.
 *
 * This keeps the dispatcher dumb (just iterate) and keeps CI green with no
 * real credentials (everything skips).
 */

import type { ChannelId, ChannelResult, ChannelSender } from './types';
import { sendOneSignalPush } from './onesignal';

function skip(channel: ChannelId, reason: string): ChannelResult {
  return { channel, status: 'skipped', reason };
}
function fail(channel: ChannelId, reason: string): ChannelResult {
  return { channel, status: 'failed', reason };
}
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Escape the small set of characters Telegram HTML mode cares about. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal transactional email body. */
function emailHtml(title: string, body: string, url: string): string {
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">',
    `<h2 style="color:#fbbf24;margin:0 0 12px">${escapeHtml(title)}</h2>`,
    `<p style="font-size:16px;line-height:1.5;color:#111">${escapeHtml(body)}</p>`,
    `<p><a href="${url}" style="display:inline-block;background:#fbbf24;color:#000;`,
    'font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">Open draft</a></p>',
    '</div>',
  ].join('');
}

// ── Push (OneSignal) ────────────────────────────────────────────────────────
export const sendPush: ChannelSender = async (message, event, prefs) => {
  if (!prefs.channels.push) return skip('push', 'channel off');
  if (!process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    return skip('push', 'not configured');
  }
  try {
    const recipients = await sendOneSignalPush({
      walletAddress: prefs.walletAddress,
      title: message.title,
      body: message.body,
      url: message.url,
      ttlSeconds: event.pickLengthSeconds ?? undefined,
    });
    return { channel: 'push', status: 'sent', recipients };
  } catch (err) {
    return fail('push', errText(err));
  }
};

// ── Email (Postmark) ─────────────────────────────────────────────────────────
export const sendEmail: ChannelSender = async (message, _event, prefs) => {
  if (!prefs.channels.email) return skip('email', 'channel off');
  if (!prefs.email) return skip('email', 'no email linked');
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;
  if (!token || !from) return skip('email', 'not configured');
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: from,
        To: prefs.email,
        Subject: message.title,
        HtmlBody: emailHtml(message.title, message.body, message.url),
        TextBody: `${message.body}\n\n${message.url}`,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      return fail('email', `Postmark ${res.status}: ${await res.text().catch(() => '')}`);
    }
    // Capture Postmark's MessageID so a log line can be traced straight
    // into Postmark's delivery activity.
    const pmBody = (await res.json().catch(() => ({}))) as { MessageID?: string };
    return { channel: 'email', status: 'sent', providerId: pmBody.MessageID };
  } catch (err) {
    return fail('email', errText(err));
  }
};

// ── Telegram (Bot API) ───────────────────────────────────────────────────────
export const sendTelegram: ChannelSender = async (message, _event, prefs) => {
  if (!prefs.channels.telegram) return skip('telegram', 'channel off');
  if (!prefs.telegramChatId) return skip('telegram', 'no telegram linked');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return skip('telegram', 'not configured');
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: prefs.telegramChatId,
        text: `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Open draft', url: message.url }]],
        },
      }),
    });
    if (!res.ok) {
      return fail('telegram', `Telegram ${res.status}: ${await res.text().catch(() => '')}`);
    }
    return { channel: 'telegram', status: 'sent' };
  } catch (err) {
    return fail('telegram', errText(err));
  }
};

// ── Discord (channel webhook + @mention) ─────────────────────────────────────
export const sendDiscord: ChannelSender = async (message, _event, prefs) => {
  if (!prefs.channels.discord) return skip('discord', 'channel off');
  if (!prefs.discordId) return skip('discord', 'no discord linked');
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return skip('discord', 'not configured');
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `<@${prefs.discordId}> **${message.title}**\n${message.body}\n${message.url}`,
        // Only ping this one user — never @everyone/@here from a draft alert.
        allowed_mentions: { users: [prefs.discordId] },
      }),
    });
    if (!res.ok) {
      return fail('discord', `Discord ${res.status}: ${await res.text().catch(() => '')}`);
    }
    return { channel: 'discord', status: 'sent' };
  } catch (err) {
    return fail('discord', errText(err));
  }
};

/** A channel paired with its id, so the dispatcher can name it on a throw. */
export interface RegisteredChannel {
  id: ChannelId;
  send: ChannelSender;
}

/** The full channel set the dispatcher fans out to. */
export const CHANNELS: RegisteredChannel[] = [
  { id: 'push', send: sendPush },
  { id: 'email', send: sendEmail },
  { id: 'telegram', send: sendTelegram },
  { id: 'discord', send: sendDiscord },
];
