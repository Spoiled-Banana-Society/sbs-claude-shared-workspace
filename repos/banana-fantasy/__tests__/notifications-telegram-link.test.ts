import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS' },
}));

const tokenRef = { get: vi.fn(), set: vi.fn() };
const prefsRef = { set: vi.fn() };
const dbMock = {
  collection: vi.fn((name: string) => ({
    doc: vi.fn(() => (name === 'notificationLinkTokens' ? tokenRef : prefsRef)),
  })),
};

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminFirestore: () => dbMock,
  isFirestoreConfigured: () => true,
}));

import {
  generateLinkToken,
  createTelegramLink,
  parseStartToken,
  consumeTelegramLink,
} from '@/lib/notifications/telegramLink';

beforeEach(() => {
  tokenRef.get.mockReset();
  tokenRef.set.mockReset();
  prefsRef.set.mockReset();
  tokenRef.set.mockResolvedValue(undefined);
  prefsRef.set.mockResolvedValue(undefined);
});

describe('generateLinkToken', () => {
  it('produces non-empty, unique tokens', () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a.length).toBeGreaterThan(10);
    expect(a).not.toBe(b);
  });
});

describe('createTelegramLink', () => {
  it('returns a t.me deep link containing the token and persists it', async () => {
    vi.stubEnv('TELEGRAM_BOT_NAME', 'SBSDraftBot');
    const { token, url } = await createTelegramLink('0xABC');
    expect(url).toBe(`https://t.me/SBSDraftBot?start=${token}`);
    expect(tokenRef.set).toHaveBeenCalledOnce();
    expect(tokenRef.set.mock.calls[0][0].walletAddress).toBe('0xabc');
  });
});

describe('parseStartToken', () => {
  it('extracts the token from "/start <token>"', () => {
    expect(parseStartToken('/start abc123')).toBe('abc123');
  });

  it('handles the "/start@BotName <token>" form', () => {
    expect(parseStartToken('/start@SBSDraftBot tok_99')).toBe('tok_99');
  });

  it('returns null for a bare /start with no token', () => {
    expect(parseStartToken('/start')).toBeNull();
  });

  it('returns null for non-start messages', () => {
    expect(parseStartToken('hello there')).toBeNull();
    expect(parseStartToken('')).toBeNull();
    expect(parseStartToken(null)).toBeNull();
  });
});

describe('consumeTelegramLink', () => {
  it('links the chat id to the wallet for a valid token', async () => {
    tokenRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        walletAddress: '0xabc',
        channel: 'telegram',
        expiresAt: Date.now() + 60_000,
      }),
    });
    const wallet = await consumeTelegramLink('tok', 778899);
    expect(wallet).toBe('0xabc');
    expect(prefsRef.set).toHaveBeenCalled();
    expect(prefsRef.set.mock.calls[0][0].telegramChatId).toBe('778899');
    // token marked consumed
    expect(tokenRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ consumedAt: 'TS' }),
      { merge: true },
    );
  });

  it('rejects an unknown token', async () => {
    tokenRef.get.mockResolvedValue({ exists: false });
    expect(await consumeTelegramLink('nope', 1)).toBeNull();
  });

  it('rejects an expired token', async () => {
    tokenRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        walletAddress: '0xabc',
        channel: 'telegram',
        expiresAt: Date.now() - 1000,
      }),
    });
    expect(await consumeTelegramLink('tok', 1)).toBeNull();
    expect(prefsRef.set).not.toHaveBeenCalled();
  });

  it('rejects an already-consumed token', async () => {
    tokenRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        walletAddress: '0xabc',
        channel: 'telegram',
        expiresAt: Date.now() + 60_000,
        consumedAt: 'TS',
      }),
    });
    expect(await consumeTelegramLink('tok', 1)).toBeNull();
  });
});
