/**
 * Per-recipient orchestration: claim the dedup slot, load prefs, fan out to
 * all channels, settle the slot. Both notification routes call this — once
 * per pick for EVENT B, once per league member for EVENT A.
 *
 * Throws only if the dedup store itself is unavailable (so the route can
 * return 502); channel failures are captured in the returned report.
 *
 * Logging: genuine channel failures and dedup-store failures go through
 * `logger.error` → the admin Logs tab (area `notifications`) + CLI + Sentry.
 * Every delivery also emits one structured `logger.info` line for tracing.
 */

import type { NotifEvent } from './types';
import { dedupKey, claimNotification, markSent, markFailed } from './dedup';
import { getUserNotifPrefs, wantsEvent } from './prefs';
import { dispatchNotification, settleOutcome } from './dispatch';
import { recordDelivery } from './activityLog';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

/** Per-channel error source so the admin Logs filter can pinpoint a channel. */
const FAIL_SOURCE: Record<string, string> = {
  push: LOG_SOURCES.notifications.PUSH_SEND_FAILED,
  email: LOG_SOURCES.notifications.EMAIL_SEND_FAILED,
  telegram: LOG_SOURCES.notifications.TELEGRAM_SEND_FAILED,
  discord: LOG_SOURCES.notifications.DISCORD_SEND_FAILED,
};

export interface DeliveryReport {
  walletAddress: string;
  /** `muted` = the user opted out of this event (e.g. fast-draft picks). */
  outcome: 'deduped' | 'sent' | 'failed' | 'muted';
  // `recipients` surfaces OneSignal's count for push so test pings
  // immediately show whether the channel reached any devices —
  // `sent` alone hides 0-recipient silent failures.
  channels?: { channel: string; status: string; reason?: string; recipients?: number }[];
}

export async function deliverToRecipient(
  walletAddress: string,
  event: NotifEvent,
): Promise<DeliveryReport> {
  const wallet = walletAddress.trim().toLowerCase();
  const key = dedupKey(wallet, event.draftId, event.pickNumber);

  let claim;
  try {
    claim = await claimNotification(key);
  } catch (err) {
    // Dedup store down — the route will 502. Surface it in the admin feed.
    logger.error(LOG_SOURCES.notifications.DEDUP_STORE_UNAVAILABLE, {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/deliver',
      actor: wallet,
      context: { event: event.type, draftId: event.draftId },
    });
    throw err;
  }
  if (claim === 'deduped') {
    recordDelivery(wallet, event, 'deduped');
    return { walletAddress: wallet, outcome: 'deduped' };
  }

  const prefs = await getUserNotifPrefs(wallet);

  // The user may have opted out of this event entirely (e.g. wants pick
  // alerts on slow drafts but not fast). Close the dedup slot so a re-fire
  // doesn't keep retrying, and skip dispatch.
  if (!wantsEvent(prefs, event)) {
    await markSent(key);
    logger.info('notifications.deliver', {
      outcome: 'muted',
      event: event.type,
      draftId: event.draftId,
      actor: wallet,
    });
    recordDelivery(wallet, event, 'muted');
    return { walletAddress: wallet, outcome: 'muted' };
  }

  const results = await dispatchNotification(event, prefs);

  // Each genuine channel failure becomes an admin-visible error so a
  // tester can see exactly which channel broke and why.
  for (const r of results) {
    if (r.status === 'failed') {
      logger.error(FAIL_SOURCE[r.channel] ?? 'notifications.channel.send_failed', {
        err: r.reason ?? 'channel send failed',
        route: 'notifications/deliver',
        actor: wallet,
        context: { event: event.type, draftId: event.draftId, channel: r.channel },
      });
    }
    // Silent push failure: OneSignal accepted the push but matched
    // zero subscribed devices. status='sent' (because OneSignal said
    // OK) but nobody actually received it. Surface as a loud error so
    // it shows up in the admin Logs tab with the wallet — admin can
    // DM the user to re-enable push on their devices.
    if (r.channel === 'push' && r.status === 'sent' && (r.recipients ?? 0) === 0) {
      logger.error(LOG_SOURCES.notifications.PUSH_ZERO_RECIPIENTS, {
        err: 'Push accepted by OneSignal but reached 0 subscribed devices for this wallet',
        route: 'notifications/deliver',
        actor: wallet,
        context: {
          event: event.type,
          draftId: event.draftId,
          recipients: r.recipients ?? 0,
        },
      });
    }
  }

  const outcome = settleOutcome(results);
  if (outcome === 'sent') await markSent(key);
  else await markFailed(key);

  // One structured trace line per delivery — visible in the Vercel logs
  // and the breadcrumb CLI so a successful/skipped run can be followed too.
  // `providerId` (e.g. the Postmark MessageID) lets a line be traced
  // straight into the channel provider's own activity log.
  logger.info('notifications.deliver', {
    outcome,
    event: event.type,
    draftId: event.draftId,
    actor: wallet,
    channels: results
      .map((r) => `${r.channel}:${r.status}${r.providerId ? `(${r.providerId})` : ''}`)
      .join(','),
  });

  // Mirror the same trace into Firestore so the admin user-lookup can
  // show per-wallet delivery history — "did this user get the alert,
  // and which channels did/didn't fire."
  recordDelivery(wallet, event, outcome, results);

  return {
    walletAddress: wallet,
    outcome,
    channels: results.map((r) => ({
      channel: r.channel,
      status: r.status,
      reason: r.reason,
      recipients: r.recipients,
    })),
  };
}
