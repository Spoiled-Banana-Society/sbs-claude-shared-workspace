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

  it('sends and targets the wallet tag when configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ONESIGNAL_APP_ID', 'app1');
    vi.stubEnv('ONESIGNAL_REST_API_KEY', 'key1');
    const fetchFn = mockFetch(true, { recipients: 5 });
    const r = await sendPush(message, event, prefs({ channels: { push: true } }));
    expect(r.status).toBe('sent');
    expect(r.recipients).toBe(5);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.app_id).toBe('app1');
    expect(body.filters[0]).toMatchObject({ key: 'walletAddress', value: '0xabc' });
    expect(body.ttl).toBe(30);
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

  it('posts a Postmark payload when configured', async () => {
    vi.stubEnv('POSTMARK_SERVER_TOKEN', 'pm-token');
    vi.stubEnv('EMAIL_FROM', 'alerts@sbs.com');
    const fetchFn = mockFetch(true);
    const r = await sendEmail(message, event, prefs({ channels: { email: true }, email: 'u@x.com' }));
    expect(r.status).toBe('sent');
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.postmarkapp.com/email');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.To).toBe('u@x.com');
    expect(body.From).toBe('alerts@sbs.com');
    expect(body.Subject).toBe('On the clock');
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

  it('posts a webhook message that @-mentions only the linked user', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord/webhook/xyz');
    const fetchFn = mockFetch(true);
    const r = await sendDiscord(
      message,
      event,
      prefs({ channels: { discord: true }, discordId: '555000' }),
    );
    expect(r.status).toBe('sent');
    expect(fetchFn.mock.calls[0][0]).toBe('https://discord/webhook/xyz');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.content).toContain('<@555000>');
    expect(body.allowed_mentions).toEqual({ users: ['555000'] });
  });
});
