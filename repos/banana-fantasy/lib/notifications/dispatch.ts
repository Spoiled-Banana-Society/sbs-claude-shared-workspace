/**
 * The dispatcher: fan one notification event out to every channel.
 *
 * Renders the copy once, runs every channel sender in parallel, and is
 * resilient — one channel failing or even throwing never blocks another.
 * Returns one `ChannelResult` per channel.
 */

import type { ChannelResult, NotifEvent, UserNotifPrefs } from './types';
import { CHANNELS, type RegisteredChannel } from './channels';
import { renderMessage } from './messages';

export async function dispatchNotification(
  event: NotifEvent,
  prefs: UserNotifPrefs,
  channels: RegisteredChannel[] = CHANNELS,
): Promise<ChannelResult[]> {
  const message = renderMessage(event);

  const settled = await Promise.allSettled(
    channels.map((c) => c.send(message, event, prefs)),
  );

  return settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    // Senders are contracted never to throw; this is a pure safety net.
    const reason = outcome.reason;
    return {
      channel: channels[i].id,
      status: 'failed',
      reason: `sender threw: ${reason instanceof Error ? reason.message : String(reason)}`,
    };
  });
}

/** True if at least one channel actually delivered. */
export function anyDelivered(results: ChannelResult[]): boolean {
  return results.some((r) => r.status === 'sent');
}

/**
 * Decide the dedup outcome from channel results:
 * - any channel sent              → 'sent'
 * - none sent but a channel failed → 'failed' (next trigger fire retries)
 * - everything skipped             → 'sent' (nothing to retry; close the slot)
 */
export function settleOutcome(results: ChannelResult[]): 'sent' | 'failed' {
  if (results.some((r) => r.status === 'sent')) return 'sent';
  if (results.some((r) => r.status === 'failed')) return 'failed';
  return 'sent';
}
