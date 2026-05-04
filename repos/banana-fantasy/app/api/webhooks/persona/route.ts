export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { json, jsonError } from '@/lib/api/routeUtils';
import { savePersonaVerification } from '@/lib/db-firestore';

const WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET || '';
const TIER1_TEMPLATE = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID_BASIC || '';
const TIER2_TEMPLATE = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID_KYC || '';

function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature || !WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('persona-signature');

    // Verify webhook signature (skip in sandbox if secret not set)
    if (WEBHOOK_SECRET && !verifySignature(rawBody, signature)) {
      console.error('[Persona Webhook] Invalid signature');
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

    console.log('[Persona Webhook] Event:', eventName, 'Status:', status, 'User:', referenceId, 'Template:', templateId);

    if (!referenceId) {
      console.warn('[Persona Webhook] No reference-id (userId) in event');
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
        console.log('[Persona Webhook] Tier 1 verified for user:', referenceId);
      } else if (templateId === TIER2_TEMPLATE) {
        // Tier 2: full KYC
        await savePersonaVerification(referenceId, {
          tier2: { verified: true, inquiryId, verifiedAt: now },
        });
        console.log('[Persona Webhook] Tier 2 (KYC) verified for user:', referenceId);
      } else {
        // Unknown template — save as tier1 by default
        await savePersonaVerification(referenceId, {
          tier1: { verified: true, inquiryId, verifiedAt: now },
        });
        console.log('[Persona Webhook] Unknown template, saved as tier1 for user:', referenceId);
      }
    } else if (status === 'failed' || status === 'declined') {
      console.log('[Persona Webhook] Verification failed/declined for user:', referenceId);
    }

    return json({ received: true }, 200);
  } catch (err) {
    console.error('[Persona Webhook] Error:', err);
    return jsonError('Webhook processing error', 500);
  }
}
