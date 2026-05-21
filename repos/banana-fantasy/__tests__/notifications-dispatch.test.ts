import { describe, it, expect, vi } from 'vitest';
import {
  dispatchNotification,
  anyDelivered,
  settleOutcome,
} from '@/lib/notifications/dispatch';
import type {
  ChannelResult,
  ChannelSender,
  NotifEvent,
  UserNotifPrefs,
} from '@/lib/notifications/types';
import type { RegisteredChannel } from '@/lib/notifications/channels';

const event: NotifEvent = { type: 'draft.filled', draftId: 'd1', draftName: 'X' };
const prefs: UserNotifPrefs = { walletAddress: '0xabc', channels: { push: true } };

function chan(id: ChannelResult['channel'], send: ChannelSender): RegisteredChannel {
  return { id, send };
}
const sent = (id: ChannelResult['channel']): ChannelSender =>
  async () => ({ channel: id, status: 'sent' });
const skipped = (id: ChannelResult['channel']): ChannelSender =>
  async () => ({ channel: id, status: 'skipped', reason: 'channel off' });

describe('dispatchNotification', () => {
  it('returns one result per channel', async () => {
    const results = await dispatchNotification(event, prefs, [
      chan('push', sent('push')),
      chan('email', skipped('email')),
      chan('telegram', sent('telegram')),
    ]);
    expect(results).toHaveLength(3);
  });

  it('calls every channel sender', async () => {
    const pushSpy = vi.fn(sent('push'));
    const emailSpy = vi.fn(sent('email'));
    await dispatchNotification(event, prefs, [
      chan('push', pushSpy),
      chan('email', emailSpy),
    ]);
    expect(pushSpy).toHaveBeenCalledOnce();
    expect(emailSpy).toHaveBeenCalledOnce();
  });

  it('is resilient when one sender throws — others still resolve', async () => {
    const thrower: ChannelSender = async () => {
      throw new Error('boom');
    };
    const results = await dispatchNotification(event, prefs, [
      chan('push', sent('push')),
      chan('email', thrower),
      chan('telegram', sent('telegram')),
    ]);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.channel === 'push')?.status).toBe('sent');
    expect(results.find((r) => r.channel === 'telegram')?.status).toBe('sent');
    const failed = results.find((r) => r.channel === 'email');
    expect(failed?.status).toBe('failed');
    expect(failed?.reason).toContain('boom');
  });

  it('renders copy once and passes it to senders', async () => {
    let received = '';
    const capture: ChannelSender = async (msg) => {
      received = msg.title;
      return { channel: 'push', status: 'sent' };
    };
    await dispatchNotification(event, prefs, [chan('push', capture)]);
    expect(received.length).toBeGreaterThan(0);
  });
});

describe('anyDelivered', () => {
  it('is true when at least one channel sent', () => {
    expect(
      anyDelivered([
        { channel: 'push', status: 'skipped' },
        { channel: 'email', status: 'sent' },
      ]),
    ).toBe(true);
  });

  it('is false when nothing sent', () => {
    expect(
      anyDelivered([
        { channel: 'push', status: 'skipped' },
        { channel: 'email', status: 'failed' },
      ]),
    ).toBe(false);
  });
});

describe('settleOutcome', () => {
  it('is "sent" when any channel delivered', () => {
    expect(
      settleOutcome([
        { channel: 'push', status: 'failed' },
        { channel: 'email', status: 'sent' },
      ]),
    ).toBe('sent');
  });

  it('is "failed" when nothing sent but a channel failed', () => {
    expect(
      settleOutcome([
        { channel: 'push', status: 'skipped' },
        { channel: 'email', status: 'failed' },
      ]),
    ).toBe('failed');
  });

  it('is "sent" when every channel skipped (nothing to retry)', () => {
    expect(
      settleOutcome([
        { channel: 'push', status: 'skipped' },
        { channel: 'email', status: 'skipped' },
      ]),
    ).toBe('sent');
  });
});
