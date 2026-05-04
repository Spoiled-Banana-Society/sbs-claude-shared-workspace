export const dynamic = 'force-dynamic';
import { json, jsonError } from '@/lib/api/routeUtils';
import { savePersonaVerification } from '@/lib/db-firestore';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const event = JSON.parse(rawBody);

    // Didit webhook v3 format
    const sessionId = event?.session_id || event?.id;
    const status = event?.status;
    const vendorData = event?.vendor_data; // userId we passed
    const features = event?.features || {};

    console.log('[Didit Webhook] Status:', status, 'User:', vendorData, 'Session:', sessionId);

    if (!vendorData) {
      console.warn('[Didit Webhook] No vendor_data (userId) in event');
      return json({ received: true }, 200);
    }

    // Didit statuses: Approved, Declined, Not Started, In Progress, Expired
    if (status === 'Approved') {
      const now = new Date().toISOString();
      // Extract geo/address info if available
      const ipAnalysis = features?.ip_analysis || {};
      const geoState = ipAnalysis?.region || ipAnalysis?.state || '';

      await savePersonaVerification(vendorData, {
        tier1: {
          verified: true,
          inquiryId: sessionId,
          verifiedAt: now,
          geoState,
        },
      });
      console.log('[Didit Webhook] Verified user:', vendorData, 'State:', geoState);
    } else if (status === 'Declined') {
      console.log('[Didit Webhook] Verification declined for user:', vendorData);
    } else if (status === 'Expired') {
      console.log('[Didit Webhook] Verification expired for user:', vendorData);
    }

    return json({ received: true }, 200);
  } catch (err) {
    console.error('[Didit Webhook] Error:', err);
    return jsonError('Webhook processing error', 500);
  }
}
