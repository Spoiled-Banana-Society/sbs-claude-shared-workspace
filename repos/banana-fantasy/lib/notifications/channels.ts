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
    const { notificationId, recipients } = await sendOneSignalPush({
      walletAddress: prefs.walletAddress,
      title: message.title,
      body: message.body,
      url: message.url,
      // Always use the 10-minute default TTL (sendOneSignalPush's
      // fallback when ttlSeconds is undefined). The earlier behavior
      // passed the pick timer length (30s for fast drafts) which made
      // APNS silently drop pushes that couldn't reach a backgrounded
      // iPhone within 30s — confirmed pattern: draft.filled landed
      // (TTL=600) while your_turn picks didn't (TTL=30). A late banner
      // is still useful awareness ("you missed pick 8, you're now at
      // pick 9") — collapseKey below ensures only the LATEST pick alert
      // for a given draft shows, so late ones can't mislead.
      ttlSeconds: undefined,
      collapseKey: event.draftId,
    });
    // providerId is the OneSignal notification id — admin user-lookup
    // uses it to fetch real delivery stats per push later.
    return {
      channel: 'push',
      status: 'sent',
      recipients,
      providerId: notificationId ?? undefined,
    };
  } catch (err) {
    return fail('push', errText(err));
  }
};

// ── Email (Resend) ───────────────────────────────────────────────────────────
// Swapped from Postmark 2026-05-26 — Postmark's 100/month free tier was
// burning through during staging tests AND their sandbox-approval gate
// silently accepted but didn't deliver. Resend's 3k/month free tier
// covers heavy testing and there's no sandbox gate; once the sending
// domain is DNS-verified, it just sends. The email_id Resend returns
// is captured as providerId; the email-webhook route updates the
// delivery row with the real outcome (delivered/bounced/complained).
export const sendEmail: ChannelSender = async (message, _event, prefs) => {
  if (!prefs.channels.email) return skip('email', 'channel off');
  if (!prefs.email) return skip('email', 'no email linked');
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return skip('email', 'not configured');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [prefs.email],
        subject: message.title,
        html: emailHtml(message.title, message.body, message.url),
        text: `${message.body}\n\n${message.url}`,
      }),
    });
    if (!res.ok) {
      return fail('email', `Resend ${res.status}: ${await res.text().catch(() => '')}`);
    }
    // Capture Resend's email id as providerId — the email-webhook route
    // uses it to match incoming delivered/bounced events back to the
    // delivery row and update its emailDelivery status.
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { channel: 'email', status: 'sent', providerId: body.id };
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
    // Capture Telegram's message_id as providerId so admin can trace a
    // specific DM. Format: "<chat_id>:<message_id>" — both are needed
    // to reconstruct a t.me link.
    const tgBody = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id?: number };
    };
    const messageId = tgBody.result?.message_id;
    return {
      channel: 'telegram',
      status: 'sent',
      providerId: messageId != null ? `${prefs.telegramChatId}:${messageId}` : undefined,
    };
  } catch (err) {
    return fail('telegram', errText(err));
  }
};

// ── Discord (private bot DM) ─────────────────────────────────────────────────
// The SBS bot opens a direct-message channel with the user and sends the
// alert there — private, never posted in a shared server channel. The bot
// can only DM a user who shares a server with it, so the user must be in
// the SBS Discord (see the join link in the settings UI).
export const sendDiscord: ChannelSender = async (message, _event, prefs) => {
  if (!prefs.channels.discord) return skip('discord', 'channel off');
  if (!prefs.discordId) return skip('discord', 'no discord linked');
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return skip('discord', 'not configured');

  const api = 'https://discord.com/api/v10';
  const auth = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' };
  try {
    // 1. Open (or reuse) the DM channel with this user.
    const dmRes = await fetch(`${api}/users/@me/channels`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ recipient_id: prefs.discordId }),
    });
    if (!dmRes.ok) {
      return fail('discord', `Discord DM open ${dmRes.status}: ${await dmRes.text().catch(() => '')}`);
    }
    const dmChannelId = (await dmRes.json())?.id as string | undefined;
    if (!dmChannelId) return fail('discord', 'Discord DM open: no channel id');

    // 2. Send the alert into that DM.
    const msgRes = await fetch(`${api}/channels/${dmChannelId}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ content: `**${message.title}**\n${message.body}\n${message.url}` }),
    });
    if (!msgRes.ok) {
      return fail('discord', `Discord DM send ${msgRes.status}: ${await msgRes.text().catch(() => '')}`);
    }
    // Capture Discord channel+message IDs as providerId — admin can
    // jump straight to the DM in Discord with discord://discord.com/channels/@me/{channel}/{message}.
    const msgBody = (await msgRes.json().catch(() => ({}))) as { id?: string };
    return {
      channel: 'discord',
      status: 'sent',
      providerId: msgBody.id ? `${dmChannelId}:${msgBody.id}` : undefined,
    };
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
