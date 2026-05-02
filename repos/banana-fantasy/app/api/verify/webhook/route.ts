export const dynamic = 'force-dynamic';
import crypto from 'node:crypto';

import { json, jsonError } from '@/lib/api/routeUtils';
import { saveKycVerification } from '@/lib/db-firestore';
import { logger } from '@/lib/logger';

/**
 * Didit posts a hex-encoded HMAC-SHA256 of the raw body in `x-signature`.
 * Set DIDIT_WEBHOOK_SECRET in Vercel env (matches the secret configured in
 * the Didit dashboard webhook). The route fails CLOSED — if the env var is
 * missing or the signature doesn't match, the request is rejected.
 *
 * Header name fallbacks cover Didit format drift across SDK versions.
 */
const SIGNATURE_HEADERS = ['x-signature', 'x-didit-signature', 'x-webhook-signature'];

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function verifySignature(rawBody: string, providedSig: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const cleaned = providedSig.replace(/^sha256=/, '').trim().toLowerCase();
  return timingSafeEqualHex(cleaned, expected);
}

export async function POST(req: Request) {
  try {
    const secret = (process.env.DIDIT_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      logger.error('didit.webhook.misconfigured', { hasSecret: false });
      return jsonError('Webhook secret not configured', 503);
    }

    const providedSig = SIGNATURE_HEADERS
      .map((h) => req.headers.get(h))
      .find((v): v is string => !!v && v.trim().length > 0);

    if (!providedSig) {
      logger.warn('didit.webhook.missing_signature');
      return jsonError('Missing webhook signature', 401);
    }

    const rawBody = await req.text();

    if (!verifySignature(rawBody, providedSig, secret)) {
      logger.warn('didit.webhook.invalid_signature');
      return jsonError('Invalid webhook signature', 401);
    }

    const event = JSON.parse(rawBody);

    // Didit webhook v3 format
    const sessionId = event?.session_id || event?.id;
    const status = event?.status;
    const vendorData = event?.vendor_data; // userId we passed
    const features = event?.features || {};

    logger.info('didit.webhook.received', { status, user: vendorData, sessionId });

    if (!vendorData) {
      logger.warn('didit.webhook.no_vendor_data');
      return json({ received: true }, 200);
    }

    // Didit statuses: Approved, Declined, Not Started, In Progress, Expired
    if (status === 'Approved') {
      const now = new Date().toISOString();
      // Extract geo/address info if available
      const ipAnalysis = features?.ip_analysis || {};
      const geoState = ipAnalysis?.region || ipAnalysis?.state || '';

      await saveKycVerification(vendorData, {
        tier1: {
          verified: true,
          inquiryId: sessionId,
          verifiedAt: now,
          geoState,
        },
      });
      logger.info('didit.webhook.verified', { user: vendorData, state: geoState });
    } else if (status === 'Declined') {
      logger.info('didit.webhook.declined', { user: vendorData });
    } else if (status === 'Expired') {
      logger.info('didit.webhook.expired', { user: vendorData });
    }

    return json({ received: true }, 200);
  } catch (err) {
    logger.error('didit.webhook.error', { err });
    return jsonError('Webhook processing error', 500);
  }
}
