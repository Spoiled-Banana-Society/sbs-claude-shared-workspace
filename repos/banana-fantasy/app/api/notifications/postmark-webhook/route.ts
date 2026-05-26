import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/notifications/postmark-webhook
 *
 * Receives Postmark delivery events (Delivery, Bounce, SpamComplaint,
 * SubscriptionChange) and updates the matching v2_notification_deliveries
 * row with the real outcome. Without this, our activity log only knows
 * "Postmark accepted the message" — Boris's email mystery was that
 * Postmark sandbox-mode accepted every send while silently dropping
 * everything until the account was approved. With this webhook the
 * admin user-lookup shows "sent → delivered to inbox ✓" or
 * "sent → marked spam ⚠" or "sent → bounced ❌" per email.
 *
 * Configure in Postmark dashboard:
 *   Server → Webhooks → "Add webhook"
 *   URL: https://banana-fantasy-sbs.vercel.app/api/notifications/postmark-webhook
 *   Triggers: Delivery, Bounce, Spam Complaint
 *
 * Postmark payload shape (varies by RecordType):
 *   { RecordType: 'Delivery' | 'Bounce' | 'SpamComplaint', MessageID, ... }
 */
export async function POST(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const recordType = typeof body.RecordType === 'string' ? body.RecordType : '';
  const messageId = typeof body.MessageID === 'string' ? body.MessageID : '';
  if (!recordType || !messageId) {
    return NextResponse.json({ error: 'missing RecordType or MessageID' }, { status: 400 });
  }

  // Map Postmark event → our normalized email status. Anything we don't
  // recognize we still capture (Postmark adds new RecordTypes over time)
  // but don't override an existing terminal status with it.
  const status: 'delivered' | 'bounced' | 'spam' | 'other' =
    recordType === 'Delivery'
      ? 'delivered'
      : recordType === 'Bounce'
        ? 'bounced'
        : recordType === 'SpamComplaint'
          ? 'spam'
          : 'other';

  // Capture useful context per event type without bloating the doc.
  const context: Record<string, unknown> = { recordType, receivedAt: new Date().toISOString() };
  if (typeof body.Recipient === 'string') context.recipient = body.Recipient;
  if (typeof body.Tag === 'string') context.tag = body.Tag;
  if (status === 'bounced') {
    if (typeof body.Type === 'string') context.bounceType = body.Type;
    if (typeof body.Description === 'string') context.bounceDescription = body.Description;
  }
  if (status === 'spam' && typeof body.Type === 'string') context.complaintType = body.Type;

  // Find the delivery row by providerId on the email channel. Each row's
  // `channels` array has an entry like { channel:'email', providerId:'<MessageID>' }.
  // Firestore doesn't index inside arrays-of-objects, so we scan the
  // recent deliveries collection. The MessageID is unique so the scan
  // is a single hit.
  try {
    const db = getAdminFirestore();
    const snap = await db
      .collection('v2_notification_deliveries')
      .orderBy('timestamp', 'desc')
      .limit(2000)
      .get();
    let updated = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as {
        channels?: Array<{ channel?: string; providerId?: string }>;
      };
      const emailChan = (data.channels || []).find(
        (c) => c.channel === 'email' && c.providerId === messageId,
      );
      if (!emailChan) continue;
      await doc.ref.update({
        emailDelivery: { status, ...context },
      });
      updated++;
      break; // MessageID is unique
    }
    logger.info('notifications.postmark_webhook', {
      context: { recordType, messageId, updated },
    });
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    logger.error('notifications.postmark_webhook.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/postmark-webhook',
      context: { recordType, messageId },
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
