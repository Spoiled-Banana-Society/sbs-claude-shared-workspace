/**
 * Per-recipient orchestration: claim the dedup slot, load prefs, fan out to
 * all channels, settle the slot. Both notification routes call this — once
 * per pick for EVENT B, once per league member for EVENT A.
 *
 * Throws only if the dedup store itself is unavailable (so the route can
 * return 502); channel failures are captured in the returned report.
 */

import type { NotifEvent } from './types';
import { dedupKey, claimNotification, markSent, markFailed } from './dedup';
import { getUserNotifPrefs, wantsEvent } from './prefs';
import { dispatchNotification, settleOutcome } from './dispatch';

export interface DeliveryReport {
  walletAddress: string;
  /** `muted` = the user opted out of this event (e.g. fast-draft picks). */
  outcome: 'deduped' | 'sent' | 'failed' | 'muted';
  channels?: { channel: string; status: string; reason?: string }[];
}

export async function deliverToRecipient(
  walletAddress: string,
  event: NotifEvent,
): Promise<DeliveryReport> {
  const wallet = walletAddress.trim().toLowerCase();
  const key = dedupKey(wallet, event.draftId, event.pickNumber);

  const claim = await claimNotification(key); // throws → route returns 502
  if (claim === 'deduped') return { walletAddress: wallet, outcome: 'deduped' };

  const prefs = await getUserNotifPrefs(wallet);

  // The user may have opted out of this event entirely (e.g. wants pick
  // alerts on slow drafts but not fast). Close the dedup slot so a re-fire
  // doesn't keep retrying, and skip dispatch.
  if (!wantsEvent(prefs, event)) {
    await markSent(key);
    return { walletAddress: wallet, outcome: 'muted' };
  }

  const results = await dispatchNotification(event, prefs);
  const outcome = settleOutcome(results);

  if (outcome === 'sent') await markSent(key);
  else await markFailed(key);

  return {
    walletAddress: wallet,
    outcome,
    channels: results.map((r) => ({
      channel: r.channel,
      status: r.status,
      reason: r.reason,
    })),
  };
}
