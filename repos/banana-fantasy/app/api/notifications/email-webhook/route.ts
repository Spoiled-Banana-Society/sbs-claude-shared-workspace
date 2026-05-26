import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/notifications/email-webhook
 *
 * Receives Resend delivery events and updates the matching
 * v2_notification_deliveries row with the real outcome.
 *
 * Configure in Resend dashboard:
 *   Webhooks → Add Endpoint
 *   URL: https://banana-fantasy-sbs.vercel.app/api/notifications/email-webhook
 *   Events: email.delivered, email.bounced, email.complained
 *
 * Resend payload shape (one event per POST):
 *   {
 *     "type": "email.delivered" | "email.bounced" | "email.complained" | ...
 *     "created_at": "...",
 *     "data": { "email_id": "<resend id>", "to": [...], "subject": "...", ... }
 *   }
 *
 * Without this the activity log only knows "Resend accepted the API
 * call" — which still lies if the email later bounces or gets spam-
 * flagged. With it the admin row shows
 * delivered to inbox ✓ / bounced ✗ / marked spam ⚠ per email.
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

  const type = typeof body.type === 'string' ? body.type : '';
  const data =
    body.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : {};
  const emailId = typeof data.email_id === 'string' ? data.email_id : '';
  if (!type || !emailId) {
    return NextResponse.json({ error: 'missing type or data.email_id' }, { status: 400 });
  }

  // Map Resend event → our normalized status. Anything we don't
  // explicitly handle goes to 'other' so future Resend event types are
  // still captured without losing the delivery row.
  const status: 'delivered' | 'bounced' | 'spam' | 'other' =
    type === 'email.delivered'
      ? 'delivered'
      : type === 'email.bounced'
        ? 'bounced'
        : type === 'email.complained'
          ? 'spam'
          : 'other';

  // `recordType` matches the field name the admin UI reads
  // (UserLookupNotificationDelivery.emailDelivery.recordType). Stored
  // as the raw Resend event type string for traceability.
  const context: Record<string, unknown> = {
    recordType: type,
    receivedAt: new Date().toISOString(),
  };
  if (Array.isArray(data.to) && typeof data.to[0] === 'string') {
    context.recipient = data.to[0];
  }
  if (typeof data.subject === 'string') context.subject = data.subject;
  if (status === 'bounced') {
    if (typeof data.bounce === 'object' && data.bounce) {
      const b = data.bounce as Record<string, unknown>;
      if (typeof b.type === 'string') context.bounceType = b.type;
      if (typeof b.message === 'string') context.bounceDescription = b.message;
    }
  }

  // Find the delivery row by providerId on the email channel. MessageIDs
  // are unique so the scan terminates at the first hit. Firestore can't
  // index inside arrays-of-objects, so we scan recent rows in time order.
  try {
    const db = getAdminFirestore();
    const snap = await db
      .collection('v2_notification_deliveries')
      .orderBy('timestamp', 'desc')
      .limit(2000)
      .get();
    let updated = 0;
    for (const doc of snap.docs) {
      const docData = doc.data() as {
        channels?: Array<{ channel?: string; providerId?: string }>;
      };
      const emailChan = (docData.channels || []).find(
        (c) => c.channel === 'email' && c.providerId === emailId,
      );
      if (!emailChan) continue;
      await doc.ref.update({
        emailDelivery: { status, ...context },
      });
      updated++;
      break;
    }
    logger.info('notifications.email_webhook', {
      context: { type, emailId, updated },
    });
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    logger.error('notifications.email_webhook.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'notifications/email-webhook',
      context: { type, emailId },
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
