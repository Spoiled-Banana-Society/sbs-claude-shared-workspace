import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS' },
}));

const snapMock: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
};
const refMock = { get: vi.fn(async () => snapMock), set: vi.fn() };
const dbMock = { collection: vi.fn(() => ({ doc: vi.fn(() => refMock) })) };

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminFirestore: () => dbMock,
  isFirestoreConfigured: () => true,
}));

import {
  getUserNotifPrefs,
  setUserNotifPrefs,
  defaultPrefs,
  wantsEvent,
} from '@/lib/notifications/prefs';
import type { UserNotifPrefs } from '@/lib/notifications/types';

beforeEach(() => {
  refMock.get.mockClear();
  refMock.set.mockClear();
  snapMock.exists = false;
  snapMock.data = () => ({});
});

describe('defaultPrefs', () => {
  it('starts every channel off and lowercases the wallet', () => {
    const p = defaultPrefs('0xABC');
    expect(p.walletAddress).toBe('0xabc');
    expect(p.channels).toEqual({});
  });
});

describe('getUserNotifPrefs', () => {
  it('returns the safe default (all channels off) when no doc exists', async () => {
    snapMock.exists = false;
    const p = await getUserNotifPrefs('0xABC');
    expect(p.channels).toEqual({});
    expect(p.email).toBeUndefined();
  });

  it('returns stored prefs and coerces channel flags to booleans', async () => {
    snapMock.exists = true;
    snapMock.data = () => ({
      email: 'a@b.com',
      telegramChatId: 12345,
      channels: { email: 1, telegram: 0 },
    });
    const p = await getUserNotifPrefs('0xABC');
    expect(p.email).toBe('a@b.com');
    expect(p.telegramChatId).toBe('12345');
    expect(p.channels.email).toBe(true);
    expect(p.channels.telegram).toBe(false);
  });

  it('lowercases the wallet', async () => {
    const p = await getUserNotifPrefs('0xABCDEF');
    expect(p.walletAddress).toBe('0xabcdef');
  });
});

describe('setUserNotifPrefs', () => {
  it('merges a patch with a lowercased wallet', async () => {
    await setUserNotifPrefs('0xABC', { email: 'x@y.com' });
    expect(refMock.set).toHaveBeenCalled();
    const [doc, opts] = refMock.set.mock.calls[0];
    expect(doc.walletAddress).toBe('0xabc');
    expect(doc.email).toBe('x@y.com');
    expect(opts).toEqual({ merge: true });
  });
});

describe('getUserNotifPrefs events', () => {
  it('reads and coerces stored event flags', async () => {
    snapMock.exists = true;
    snapMock.data = () => ({ events: { pickFast: 0, pickSlow: 1 } });
    const p = await getUserNotifPrefs('0xABC');
    expect(p.events?.pickFast).toBe(false);
    expect(p.events?.pickSlow).toBe(true);
  });
});

function prefsWith(events?: UserNotifPrefs['events']): UserNotifPrefs {
  return { walletAddress: '0xabc', channels: {}, events };
}

describe('wantsEvent', () => {
  it('defaults every event to ON when no events pref is set', () => {
    expect(wantsEvent(prefsWith(), { type: 'draft.filled', draftId: 'd' })).toBe(true);
    expect(
      wantsEvent(prefsWith(), { type: 'draft.your_turn', draftId: 'd', pickLengthSeconds: 30 }),
    ).toBe(true);
  });

  it('honors an explicit draftFilled = false', () => {
    expect(
      wantsEvent(prefsWith({ draftFilled: false }), { type: 'draft.filled', draftId: 'd' }),
    ).toBe(false);
  });

  it('routes "your turn" by draft speed (fast = under 1h pick)', () => {
    const fast = { type: 'draft.your_turn' as const, draftId: 'd', pickLengthSeconds: 30 };
    const slow = { type: 'draft.your_turn' as const, draftId: 'd', pickLengthSeconds: 28800 };
    const prefs = prefsWith({ pickFast: false, pickSlow: true });
    expect(wantsEvent(prefs, fast)).toBe(false);
    expect(wantsEvent(prefs, slow)).toBe(true);
  });

  it('treats an unknown/zero pick length as a fast draft', () => {
    expect(
      wantsEvent(prefsWith({ pickFast: false }), { type: 'draft.your_turn', draftId: 'd' }),
    ).toBe(false);
  });
});
