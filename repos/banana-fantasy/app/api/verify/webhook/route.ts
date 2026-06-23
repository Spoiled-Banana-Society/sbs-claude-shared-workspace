export const dynamic = 'force-dynamic';
import crypto from 'crypto';
import { json, jsonError } from '@/lib/api/routeUtils';
import { savePersonaVerification } from '@/lib/db-firestore';
import { pushStreamEventBg } from '@/lib/userEventStream';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { isProd } from '@/lib/envGates';

const DIDIT_WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET || '';

// Recursively sort object keys so the canonical JSON we sign matches what
// Didit signs. Per their X-Signature-V2 spec, key ordering must be identical
// or the HMAC won't match.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.keys(obj).sort().reduce((result: any, key: string) => {
      result[key] = sortKeys(obj[key]);
      return result;
    }, {});
  }
  return obj;
}

// HMAC-SHA256 verification per Didit X-Signature-V2 spec. We use V2 over V1
// because V2 is immune to JSON re-encoding by middleware (Next.js / Vercel
// edge could canonicalize whitespace and break the V1 raw-body match).
function verifyDiditSignature(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedBody: any,
  signatureHeader: string,
  timestampHeader: string,
): boolean {
  if (!DIDIT_WEBHOOK_SECRET) {
    // FAIL CLOSED in prod: with no secret we can't verify Didit's signature, and
    // accepting an unsigned body would let anyone POST a fake "KYC approved" for
    // any wallet → bypass the withdrawal/KYC gate. Reject. (Local dev, where the
    // secret legitimately isn't set, still fails open so KYC can be tested.)
    if (isProd()) {
      console.error('[Didit Webhook] No DIDIT_WEBHOOK_SECRET in PROD — REJECTING (cannot verify; unsigned KYC would be spoofable). Set the secret in the Vercel dashboard.');
      return false;
    }
    console.warn('[Didit Webhook] No webhook secret configured — verification skipped (dev only)');
    return true;
  }

  if (!signatureHeader || !timestampHeader) {
    console.warn('[Didit Webhook] Missing signature or timestamp header');
    return false;
  }

  // Reject events older than 5 minutes (replay protection)
  const currentTime = Math.floor(Date.now() / 1000);
  const incomingTime = parseInt(timestampHeader, 10);
  if (!Number.isFinite(incomingTime) || Math.abs(currentTime - incomingTime) > 300) {
    console.warn('[Didit Webhook] Timestamp out of valid range');
    return false;
  }

  const canonical = JSON.stringify(sortKeys(parsedBody));
  const expected = crypto
    .createHmac('sha256', DIDIT_WEBHOOK_SECRET)
    .update(canonical, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signatureHeader, 'utf8'),
    );
  } catch {
    return false;
  }
}

// Pull verified identity fields out of Didit's webhook payload defensively.
// The exact shape varies by workflow (age estimation vs. full KYC vs. AML),
// so we probe several common locations and fall back gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractVerifiedIdentity(event: any) {
  const features = event?.features ?? {};
  const idVerification = features?.id_verification ?? {};
  const docData = idVerification?.document_data ?? idVerification ?? {};
  const ipAnalysis = features?.ip_analysis ?? {};

  // Address can live in a few places. Try most-specific first.
  const docAddress = docData?.address ?? {};
  const ipState = ipAnalysis?.region || ipAnalysis?.state || '';
  const ipCountry = ipAnalysis?.country_code || ipAnalysis?.country || '';

  return {
    firstName:
      docData?.first_name ||
      docData?.firstName ||
      docData?.given_names ||
      undefined,
    lastName:
      docData?.last_name || docData?.lastName || docData?.surname || undefined,
    dateOfBirth:
      docData?.date_of_birth || docData?.dateOfBirth || docData?.dob || undefined,
    address: {
      street: docAddress?.street || docAddress?.address_line_1 || undefined,
      city: docAddress?.city || undefined,
      // 2-letter US state preferred. Fall back to IP analysis if the ID
      // didn't include one (e.g., age-only workflows).
      state:
        docAddress?.state ||
        docAddress?.region ||
        docAddress?.subdivision ||
        ipState ||
        undefined,
      parish: docAddress?.county || docAddress?.parish || undefined,
      zip: docAddress?.zip || docAddress?.postal_code || undefined,
      country: docAddress?.country || ipCountry || undefined,
    },
  };
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return jsonError('Invalid JSON', 400);
    }

    // Verify HMAC signature before trusting any data in the payload
    const sigV2 = req.headers.get('x-signature-v2') || '';
    const timestamp = req.headers.get('x-timestamp') || '';
    if (!verifyDiditSignature(event, sigV2, timestamp)) {
      console.error('[Didit Webhook] Signature verification failed');
      logger.error(LOG_SOURCES.kyc.WEBHOOK_INVALID_SIGNATURE, {
        route: '/api/verify/webhook',
        hasSignature: !!sigV2,
        hasTimestamp: !!timestamp,
      });
      return jsonError('Invalid signature', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = event as any;
    const sessionId: string | undefined = e?.session_id || e?.id;
    const status: string | undefined = e?.status;
    const vendorData: string | undefined = e?.vendor_data;

    console.log(
      '[Didit Webhook] Verified event — status:',
      status,
      'user:',
      vendorData,
      'session:',
      sessionId,
    );

    if (!vendorData) {
      console.warn('[Didit Webhook] No vendor_data (userId) in event');
      return json({ received: true }, 200);
    }

    if (status === 'Approved') {
      const now = new Date().toISOString();
      const identity = extractVerifiedIdentity(event);

      await savePersonaVerification(vendorData, {
        tier1: {
          verified: true,
          inquiryId: sessionId,
          verifiedAt: now,
          geoState: identity.address.state,
        },
        verifiedIdentity: {
          firstName: identity.firstName,
          lastName: identity.lastName,
          dateOfBirth: identity.dateOfBirth,
          address: identity.address,
          sessionId,
          verifiedAt: now,
        },
      });

      console.log(
        '[Didit Webhook] Verified user:',
        vendorData,
        'state:',
        identity.address.state,
        'country:',
        identity.address.country,
      );

      // Real-time: ping the user's event stream so any open /verify (or a
      // gated checkout step waiting on KYC) refetches eligibility within
      // ~300ms and flips to verified live — no manual reload. Keyed on the
      // same Privy userId (vendor_data) the client subscribes with. Survives
      // the response via the bg variant (Vercel lambda would drop a bare void).
      pushStreamEventBg(vendorData, 'notification', { source: 'kyc-verified' });
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
