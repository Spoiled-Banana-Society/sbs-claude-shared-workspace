import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS' },
}));

// Controllable fake Firestore document ref.
const refMock = {
  create: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};
const dbMock = {
  collection: vi.fn(() => ({ doc: vi.fn(() => refMock) })),
};

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminFirestore: () => dbMock,
  isFirestoreConfigured: () => true,
}));

import { claimNotification, dedupKey } from '@/lib/notifications/dedup';

beforeEach(() => {
  refMock.create.mockReset();
  refMock.get.mockReset();
  refMock.set.mockReset();
});

describe('dedupKey', () => {
  it('uses the pick number for your-turn events', () => {
    expect(dedupKey('0xABC', 'd1', 7)).toBe('0xabc__d1__7');
  });

  it('uses "filled" when there is no pick number', () => {
    expect(dedupKey('0xABC', 'd1')).toBe('0xabc__d1__filled');
  });
});

describe('claimNotification', () => {
  it('returns "claimed" when create() succeeds', async () => {
    refMock.create.mockResolvedValue(undefined);
    expect(await claimNotification('k')).toBe('claimed');
  });

  it('returns "deduped" when the doc exists and status is sent (gRPC code 6)', async () => {
    refMock.create.mockRejectedValue({ code: 6 });
    refMock.get.mockResolvedValue({ exists: true, get: () => 'sent' });
    expect(await claimNotification('k')).toBe('deduped');
  });

  it('returns "retry" when a prior attempt failed (string code "already-exists")', async () => {
    refMock.create.mockRejectedValue({ code: 'already-exists' });
    refMock.get.mockResolvedValue({ exists: true, get: () => 'failed' });
    refMock.set.mockResolvedValue(undefined);
    expect(await claimNotification('k')).toBe('retry');
    expect(refMock.set).toHaveBeenCalled();
  });

  it('returns "deduped" when another worker is in flight (pending)', async () => {
    refMock.create.mockRejectedValue({ code: 6 });
    refMock.get.mockResolvedValue({ exists: true, get: () => 'pending' });
    expect(await claimNotification('k')).toBe('deduped');
  });

  it('throws on a non-dedup Firestore error', async () => {
    refMock.create.mockRejectedValue({ code: 13 });
    await expect(claimNotification('k')).rejects.toBeDefined();
  });
});
