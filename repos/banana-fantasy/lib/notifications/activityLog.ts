/**
 * Per-recipient delivery activity log.
 *
 * Companion to v2_error_events. Errors only capture *failures* — they don't
 * answer "did Boris's brother get a draft-filled push for draft #821?"
 * `notifications.deliver` already emits a structured `logger.info` per
 * delivery, but that line only lives in the Vercel/Cloud Run console — not
 * queryable per-wallet from the admin user lookup.
 *
 * This module mirrors those info lines into Firestore so the admin
 * Notifications panel can show "last N delivery attempts for this wallet"
 * with the same field shape (event, draftId, outcome, per-channel results).
 *
 * Fire-and-forget: writes never throw and never block delivery. A
 * downed Firestore degrades observability, not user-facing alerts.
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import type { ChannelResult, NotifEvent } from './types';

const COLLECTION = 'v2_notification_deliveries';
const MAX_REASON_LEN = 300;

/** One row in `v2_notification_deliveries`. */
export interface NotificationDeliveryRecord {
  walletAddress: string;
  event: NotifEvent['type'];
  draftId: string;
  draftName?: string;
  pickNumber?: number;
  pickLengthSeconds?: number;
  outcome: 'sent' | 'muted' | 'deduped' | 'failed';
  /**
   * Present for sent/muted/failed. Omitted for `deduped` because the
   * dispatcher never ran. Reasons are truncated so a noisy provider
   * error can't blow up the doc size.
   */
  channels?: {
    channel: ChannelResult['channel'];
    status: ChannelResult['status'];
    reason?: string;
    recipients?: number;
    providerId?: string;
  }[];
  timestamp: string;
}

function trim(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.length > MAX_REASON_LEN ? `${s.slice(0, MAX_REASON_LEN)}…` : s;
}

/**
 * Record a single recipient's delivery outcome. Called from
 * `deliverToRecipient` after every dispatch (and on the dedup / mute
 * short-circuits). Returns a void promise so callers can `void` it
 * without an unhandled-rejection warning, but never rejects.
 */
export function recordDelivery(
  walletAddress: string,
  event: NotifEvent,
  outcome: NotificationDeliveryRecord['outcome'],
  channels?: ChannelResult[],
): void {
  if (!isFirestoreConfigured()) return;
  try {
    const doc: NotificationDeliveryRecord = {
      walletAddress: walletAddress.trim().toLowerCase(),
      event: event.type,
      draftId: event.draftId,
      outcome,
      timestamp: new Date().toISOString(),
    };
    if (event.draftName) doc.draftName = event.draftName;
    if (event.pickNumber != null) doc.pickNumber = event.pickNumber;
    if (event.pickLengthSeconds != null) doc.pickLengthSeconds = event.pickLengthSeconds;
    if (channels && channels.length) {
      doc.channels = channels.map((c) => {
        const out: NonNullable<NotificationDeliveryRecord['channels']>[number] = {
          channel: c.channel,
          status: c.status,
        };
        const reason = trim(c.reason);
        if (reason) out.reason = reason;
        if (c.recipients != null) out.recipients = c.recipients;
        if (c.providerId) out.providerId = c.providerId;
        return out;
      });
    }
    void getAdminFirestore()
      .collection(COLLECTION)
      .add(doc)
      .catch(() => {
        /* swallow — observability must never block the alert */
      });
  } catch {
    /* swallow */
  }
}

/**
 * Pull the last `limit` deliveries for a wallet, newest first. Uses the
 * same in-memory sort pattern as the rest of the admin user-lookup so a
 * composite Firestore index isn't required.
 */
export async function fetchRecentDeliveries(
  wallet: string,
  limit = 25,
): Promise<NotificationDeliveryRecord[]> {
  if (!isFirestoreConfigured()) return [];
  const w = wallet.trim().toLowerCase();
  const snap = await getAdminFirestore()
    .collection(COLLECTION)
    .where('walletAddress', '==', w)
    .limit(Math.min(limit * 4, 200))
    .get();
  const rows = snap.docs.map((d) => d.data() as NotificationDeliveryRecord);
  rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return rows.slice(0, limit);
}
