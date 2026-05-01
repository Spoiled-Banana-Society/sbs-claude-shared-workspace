export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { json, jsonError } from '@/lib/api/routeUtils';
import { savePersonaVerification } from '@/lib/db-firestore';
import { logger } from '@/lib/logger';

const TIER1_TEMPLATE = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID_BASIC || '';
const TIER2_TEMPLATE = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID_KYC || '';

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedBuf = Buffer.from(signature.replace(/^sha256=/, '').trim().toLowerCase(), 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const secret = (process.env.PERSONA_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      // Fail CLOSED — without the secret we can't verify the webhook came
      // from Persona. The previous behavior (skip verification when secret
      // missing) let anyone POST fake "verified" events and bypass KYC.
      // Same fix shape as the Didit webhook.
      logger.error('persona.webhook.no_signing_secret');
      return jsonError('Webhook secret not configured', 503);
    }

    const rawBody = await req.text();
    const signature = req.headers.get('persona-signature') ?? '';
    if (!signature || !verifySignature(rawBody, signature, secret)) {
      logger.warn('persona.webhook.bad_signature');
      return jsonError('Invalid signature', 401);
    }

    const event = JSON.parse(rawBody);
    const eventName = event?.data?.attributes?.name || event?.data?.type;
    const inquiryData = event?.data?.attributes;

    if (!inquiryData) {
      return json({ received: true }, 200);
    }

    const status = inquiryData.status;
    const referenceId = inquiryData['reference-id']; // userId we passed
    const inquiryId = event?.data?.id;
    const templateId = inquiryData['inquiry-template-id'];

    logger.info('persona.webhook.received', { event: eventName, status, user: referenceId, template: templateId });

    if (!referenceId) {
      logger.warn('persona.webhook.no_reference_id');
      return json({ received: true }, 200);
    }

    // Only process completed/approved inquiries
    if (status === 'completed' || status === 'approved') {
      const now = new Date().toISOString();

      if (templateId === TIER1_TEMPLATE) {
        // Tier 1: age + geo verification
        const fields = inquiryData.fields || {};
        const geoState = fields['address-state']?.value || fields['address-subdivision']?.value || '';
        await savePersonaVerification(referenceId, {
          tier1: { verified: true, inquiryId, verifiedAt: now, geoState },
        });
        logger.info('persona.webhook.tier1_verified', { user: referenceId, geoState });
      } else if (templateId === TIER2_TEMPLATE) {
        // Tier 2: full KYC
        await savePersonaVerification(referenceId, {
          tier2: { verified: true, inquiryId, verifiedAt: now },
        });
        logger.info('persona.webhook.tier2_verified', { user: referenceId });
      } else {
        // Unknown template — save as tier1 by default
        await savePersonaVerification(referenceId, {
          tier1: { verified: true, inquiryId, verifiedAt: now },
        });
        logger.info('persona.webhook.unknown_template_tier1', { user: referenceId, templateId });
      }
    } else if (status === 'failed' || status === 'declined') {
      logger.info('persona.webhook.failed_or_declined', { user: referenceId, status });
    }

    return json({ received: true }, 200);
  } catch (err) {
    logger.error('persona.webhook.unhandled', { route: '/api/webhooks/persona', err });
    return jsonError('Webhook processing error', 500);
  }
}
