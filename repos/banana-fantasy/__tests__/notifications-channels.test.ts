import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendPush,
  sendEmail,
  sendTelegram,
  sendDiscord,
  CHANNELS,
} from '@/lib/notifications/channels';
import type { NotifEvent, RenderedMessage, UserNotifPrefs } from '@/lib/notifications/types';

const message: RenderedMessage = {
  title: 'On the clock',
  body: 'Tap to pick.',
  url: 'https://app/draft-room?id=d1',
};
const event: NotifEvent = { type: 'draft.your_turn', draftId: 'd1', pickLengthSeconds: 30 };

function prefs(over: Partial<UserNotifPrefs> = {}): UserNotifPrefs {
  return { walletAddress: '0xabc', channels: {}, ...over };
}

/** Install a fake fetch that records calls and returns `ok`. */
function mockFetch(ok = true, json: unknown = { recipients: 3 }) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => json,
    text: async () => (ok ? '' : 'err'),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/**
 * Two-step mockFetch for the new sendPush flow: first call returns
 * OneSignal /players lookup, second call returns the /notifications
 * send response. Lets one test cover both halves of the player-id
 * targeting path.
 */
function mockOneSignalFetch(opts: {
  players: Array<{ id: string; tags?: Record<string, string>; invalid_identifier?: boolean }>;
  sendResponse?: Record<string, unknown>;
}) {
  const fn = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ players: opts.players }),
      text: async () => '',
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => opts.sendResponse ?? { id: 'notif-xyz' },
      text: async () => '',
    });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('CHANNELS registry', () => {
  it('contains all four senders', () => {
    expect(CHANNELS).toHaveLength(4);
  });
});

describe('sendPush', () => {
  it('skips when the push channel is off', async () => {
    const r = await sendPush(message, event, prefs({ channels: { push: false } }));
    expect(r.status).toBe('skipped');
  });

  it('skips when OneSignal env is not configured', async () => {
    const r = await sendPush(message, event, prefs({ channels: { push: true } }));
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/configured/);
  });

  it('looks up player ids by wallet tag then sends with include_player_ids', async () => {
    // The dispatcher's send is two-step: list players tagged with the
    // wallet (so v2 SDK subscriptions are reachable — the tag-filtered
    // send path silently drops them), then target by include_player_ids.
    vi.stubEnv('NEXT_PUBLIC_ONESIGNAL_APP_ID', 'app1');
    vi.stubEnv('ONESIGNAL_REST_API_KEY', 'key1');
    const fetchFn = mockOneSignalFetch({
      players: [
        { id: 'player-1', tags: { walletAddress: '0xabc' } },
        { id: 'player-2', tags: { walletAddress: '0xabc' } },
        { id: 'player-other', tags: { walletAddress: '0xother' } }, // not us
      ],
      sendResponse: { id: 'notif-abc' },
    });
    const r = await sendPush(message, event, prefs({ channels: { push: true } }));
    expect(r.status).toBe('sent');
    expect(r.recipients).toBe(2); // matches the 2 player IDs we sent to
    expect(r.providerId).toBe('notif-abc'); // notification id captured for delivery stats

    // Lookup call
    expect(fetchFn.mock.calls[0][0]).toContain('/api/v1/players');
    // Send call
    const sendBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(sendBody.app_id).toBe('app1');
    expect(sendBody.include_player_ids).toEqual(['player-1', 'player-2']);
    // TTL is always the 10-min default (not the pick-timer length).
    // A 30s pick timer used to be passed through verbatim — APNS
    // silently dropped any push that couldn't reach a backgrounded
    // iPhone within 30s. See the comment on the sendPush call site
    // in lib/notifications/channels.ts for the full incident.
    expect(sendBody.ttl).toBe(600);
  });

  it('drops players OneSignal marked invalid_identifier', async () => {
    vi.stubEnv('NEXT_PUBLIC_ONESIGNAL_APP_ID', 'app1');
    vi.stubEnv('ONESIGNAL_REST_API_KEY', 'key1');
    const fetchFn = mockOneSignalFetch({
      players: [
        { id: 'player-good', tags: { walletAddress: '0xabc' } },
        { id: 'player-dead', tags: { walletAddress: '0xabc' }, invalid_identifier: true },
      ],
      sendResponse: { id: 'notif-abc' },
    });
    const r = await sendPush(message, event, prefs({ channels: { push: true } }));
    expect(r.status).toBe('sent');
    expect(r.recipients).toBe(1); // only the good one
    const sendBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(sendBody.include_player_ids).toEqual(['player-good']);
  });

  it('returns recipients:0 when no players are tagged with this wallet', async () => {
    vi.stubEnv('NEXT_PUBLIC_ONESIGNAL_APP_ID', 'app1');
    vi.stubEnv('ONESIGNAL_REST_API_KEY', 'key1');
    mockOneSignalFetch({
      players: [{ id: 'someone-else', tags: { walletAddress: '0xother' } }],
    });
    const r = await sendPush(message, event, prefs({ channels: { push: true } }));
    expect(r.status).toBe('sent');
    expect(r.recipients).toBe(0);
    // No notification id when nothing was sent
    expect(r.providerId).toBeUndefined();
  });

  it('sets web_push_topic to the draftId so rapid picks collapse into one banner', async () => {
    // Without web_push_topic, 8 picks in quick succession = 8 stacked
    // banners on the user's lock screen. With it, each new notification
    // for the same draft REPLACES the previous one in-place. User sees
    // one always-current banner ("pick 7 → pick 8 → pick 9") instead
    // of a noisy stack of stale alerts.
    vi.stubEnv('NEXT_PUBLIC_ONESIGNAL_APP_ID', 'app1');
    vi.stubEnv('ONESIGNAL_REST_API_KEY', 'key1');
    const fetchFn = mockOneSignalFetch({
      players: [{ id: 'p1', tags: { walletAddress: '0xabc' } }],
      sendResponse: { id: 'notif-1' },
    });
    await sendPush(message, event, prefs({ channels: { push: true } }));
    const sendBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(sendBody.web_push_topic).toBe('d1');
    // iOS APNS-collapse-id mirrors web_push_topic for iOS PWA pushes.
    expect(sendBody.collapse_id).toBe('d1');
  });
});

describe('sendEmail', () => {
  it('skips when the email channel is off', async () => {
    const r = await sendEmail(message, event, prefs({ channels: { email: false }, email: 'a@b.com' }));
    expect(r.status).toBe('skipped');
  });

  it('skips when no email is linked', async () => {
    const r = await sendEmail(message, event, prefs({ channels: { email: true } }));
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/email/);
  });

  it('posts a Resend payload when configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_key');
    vi.stubEnv('EMAIL_FROM', 'alerts@sbs.com');
    const fetchFn = mockFetch(true, { id: 'resend-email-id-1' });
    const r = await sendEmail(message, event, prefs({ channels: { email: true }, email: 'u@x.com' }));
    expect(r.status).toBe('sent');
    expect(r.providerId).toBe('resend-email-id-1'); // captured for the email-webhook to match against
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    const init = fetchFn.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer re_key');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['u@x.com']);
    expect(body.from).toBe('alerts@sbs.com');
    expect(body.subject).toBe('On the clock');
  });

  it('skips when RESEND_API_KEY is unset', async () => {
    vi.stubEnv('EMAIL_FROM', 'alerts@sbs.com');
    // No RESEND_API_KEY stubbed
    const r = await sendEmail(message, event, prefs({ channels: { email: true }, email: 'u@x.com' }));
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/configured/);
  });
});

describe('sendTelegram', () => {
  it('skips when no Telegram chat is linked', async () => {
    const r = await sendTelegram(message, event, prefs({ channels: { telegram: true } }));
    expect(r.status).toBe('skipped');
  });

  it('posts sendMessage with the chat id and a deep-link button', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    const fetchFn = mockFetch(true);
    const r = await sendTelegram(
      message,
      event,
      prefs({ channels: { telegram: true }, telegramChatId: '99887' }),
    );
    expect(r.status).toBe('sent');
    expect(fetchFn.mock.calls[0][0]).toContain('/botbot-token/sendMessage');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.chat_id).toBe('99887');
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe(message.url);
  });

  it('returns failed when Telegram responds non-OK', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    mockFetch(false);
    const r = await sendTelegram(
      message,
      event,
      prefs({ channels: { telegram: true }, telegramChatId: '1' }),
    );
    expect(r.status).toBe('failed');
  });
});

describe('sendDiscord', () => {
  it('skips when no Discord account is linked', async () => {
    const r = await sendDiscord(message, event, prefs({ channels: { discord: true } }));
    expect(r.status).toBe('skipped');
  });

  it('skips when the bot token is unset', async () => {
    const r = await sendDiscord(
      message,
      event,
      prefs({ channels: { discord: true }, discordId: '555000' }),
    );
    expect(r.status).toBe('skipped');
  });

  it('opens a DM with the linked user and sends the alert privately', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'bot-tok');
    const fetchFn = mockFetch(true, { id: 'dm-chan-1' });
    const r = await sendDiscord(
      message,
      event,
      prefs({ channels: { discord: true }, discordId: '555000' }),
    );
    expect(r.status).toBe('sent');
    // 1. opens a DM channel with the user's id, authed as the bot
    expect(fetchFn.mock.calls[0][0]).toBe('https://discord.com/api/v10/users/@me/channels');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).recipient_id).toBe('555000');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bot bot-tok');
    // 2. sends the message into that DM channel — no channel @mention
    expect(fetchFn.mock.calls[1][0]).toBe(
      'https://discord.com/api/v10/channels/dm-chan-1/messages',
    );
    const body = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body.content).toContain(message.title);
    expect(body.content).not.toContain('<@');
  });

  it('returns failed when Discord responds non-OK', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'bot-tok');
    mockFetch(false);
    const r = await sendDiscord(
      message,
      event,
      prefs({ channels: { discord: true }, discordId: '1' }),
    );
    expect(r.status).toBe('failed');
  });
});
