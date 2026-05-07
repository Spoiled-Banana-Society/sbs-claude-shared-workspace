export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { savePersonaVerification, type VerifiedIdentity } from '@/lib/db-firestore';
import { checkBlockRules } from '@/lib/verifyBlockRules';

// Custom KYC submission endpoint:
//   POST /api/verify/submit
// Multipart form fields:
//   firstName, lastName, dateOfBirth (YYYY-MM-DD), country (US|CA),
//   street, city, state, zip
//   idImage (binary file)
//
// Flow:
//   1. Verify Privy bearer (user is authenticated)
//   2. POST the ID image to Didit's standalone synchronous endpoint
//      (POST /v3/id-verification/) — no session, no polling, just an
//      immediate verification result
//   3. Compare extracted fields against the form values
//   4. Run SBS-specific block rules (state/parish/age) on extracted data
//   5. Save verification + identity to Firestore
//   6. Return { approved: true } or { approved: false, reason }

const DIDIT_API_KEY = process.env.DIDIT_API_KEY || '';
const DIDIT_BASE_URL = 'https://verification.didit.me';
const MAX_ID_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]);

function readFormString(form: FormData, key: string, max = 200): string {
  const v = form.get(key);
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function nameMatches(formName: string, idName: string | undefined): boolean {
  if (!idName) return false;
  const a = formName.trim().toLowerCase();
  const b = idName.trim().toLowerCase();
  if (!a || !b) return false;
  // Loose match — Didit may return "John A" while user typed "John". Accept if
  // either is a prefix of the other or they share the first token.
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const aFirst = a.split(/\s+/)[0];
  const bFirst = b.split(/\s+/)[0];
  return !!aFirst && aFirst === bFirst;
}

function dobMatches(formDob: string, idDob: string | undefined): boolean {
  if (!idDob) return false;
  // Both should be ISO YYYY-MM-DD. Compare just the date portion.
  const a = formDob.slice(0, 10);
  const b = idDob.slice(0, 10);
  return a === b && a.length === 10;
}

export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  if (!DIDIT_API_KEY) return jsonError('Didit API key not configured', 500);

  try {
    const session = await getPrivyUser(req);

    // Multipart form parsing
    const form = await req.formData();
    const firstName = readFormString(form, 'firstName', 100);
    const lastName = readFormString(form, 'lastName', 100);
    const dateOfBirth = readFormString(form, 'dateOfBirth', 10);
    const country = readFormString(form, 'country', 2).toUpperCase();
    const street = readFormString(form, 'street', 200);
    const city = readFormString(form, 'city', 100);
    const state = readFormString(form, 'state', 10).toUpperCase();
    const zip = readFormString(form, 'zip', 20);
    const idImage = form.get('idImage');

    if (!firstName || !lastName) return jsonError('Name is required', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return jsonError('Date of birth must be YYYY-MM-DD', 400);
    }
    if (country !== 'US' && country !== 'CA') {
      return jsonError('Country must be US or CA', 400);
    }
    if (!street || !city || !state || !zip) {
      return jsonError('Address is required', 400);
    }
    if (!(idImage instanceof File)) {
      return jsonError('ID image is required', 400);
    }
    if (idImage.size > MAX_ID_FILE_SIZE) {
      return jsonError('ID image exceeds 10MB limit', 400);
    }
    if (idImage.type && !ALLOWED_MIME_TYPES.has(idImage.type)) {
      return jsonError('ID image must be JPG, PNG, HEIC, or WEBP', 400);
    }

    // Step 1: Send the ID image directly to Didit's standalone synchronous
    // endpoint. No session, no polling — Didit validates the document and
    // returns extracted fields in the response body.
    const diditForm = new FormData();
    diditForm.append('front_image', idImage, idImage.name || 'id.jpg');
    diditForm.append('vendor_data', session.userId);
    diditForm.append('save_api_request', 'true');

    const verifyRes = await fetch(`${DIDIT_BASE_URL}/v3/id-verification/`, {
      method: 'POST',
      headers: {
        'x-api-key': DIDIT_API_KEY,
        // Don't set Content-Type — fetch sets multipart boundary automatically
      },
      body: diditForm,
    });
    if (!verifyRes.ok) {
      const text = await verifyRes.text();
      console.error('[Verify Submit] Didit ID verification failed:', verifyRes.status, text);
      return jsonError(
        'Failed to verify ID. Please try a clearer photo of your driver\'s license, passport, or state ID.',
        502,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verifyData = await verifyRes.json() as any;
    const idVer = verifyData?.id_verification ?? {};
    const decision: string = idVer?.status || 'Declined';
    const requestId: string | undefined = verifyData?.request_id;

    if (decision !== 'Approved') {
      const warnings: string[] = Array.isArray(idVer?.warnings) ? idVer.warnings : [];
      const detail = warnings.length > 0 ? ` (${warnings.join(', ')})` : '';
      return json({
        approved: false,
        reason: `We couldn't verify the ID you uploaded${detail}. Please try a clearer photo of a valid government-issued ID.`,
      });
    }

    // Step 2: Cross-check extracted ID data against the user's form values.
    const idFirstName: string | undefined = idVer?.first_name;
    const idLastName: string | undefined = idVer?.last_name;
    const idDob: string | undefined = idVer?.date_of_birth;

    if (!nameMatches(firstName, idFirstName) || !nameMatches(lastName, idLastName)) {
      return json({
        approved: false,
        reason:
          "The name on your ID doesn't match the name you entered. Please verify both fields and try again.",
      });
    }
    if (!dobMatches(dateOfBirth, idDob)) {
      return json({
        approved: false,
        reason:
          "The date of birth on your ID doesn't match what you entered. Please verify and try again.",
      });
    }

    // Step 5: Build the verifiedIdentity record from a mix of form data
    // (which the user typed) and extracted ID data (Didit-validated).
    // Address comes from the form since the ID address may be outdated.
    // Firestore rejects `undefined` values, so optional fields are omitted
    // when absent rather than set to undefined. If state is LA, we'd want
    // a parish field; for now the backend block-rule skips parish check
    // when not present (future: dedicated parish input for LA users).
    const verifiedIdentity: VerifiedIdentity = {
      firstName,
      lastName,
      dateOfBirth,
      address: {
        street,
        city,
        state,
        country,
        zip,
      },
      verifiedAt: new Date().toISOString(),
    };
    if (requestId) verifiedIdentity.sessionId = requestId;

    // Step 6: Run SBS block rules — banned states, parish, age, country.
    const blockResult = checkBlockRules(verifiedIdentity);
    if (blockResult.blocked) {
      // Save the verified identity even when blocked so we don't ask for
      // the same docs again next time. The cashout endpoint will hit the
      // same block rule and reject with the same reason.
      // Optional fields (inquiryId, geoState) are spread conditionally —
      // Firestore rejects explicit undefined values.
      await savePersonaVerification(session.userId, {
        tier1: {
          verified: true,
          verifiedAt: new Date().toISOString(),
          ...(requestId ? { inquiryId: requestId } : {}),
          ...(state ? { geoState: state } : {}),
        },
        verifiedIdentity,
      });
      return json({
        approved: false,
        reason: blockResult.message || 'Verification not permitted in your jurisdiction.',
        blockCode: blockResult.code,
      });
    }

    // Step 7: All checks passed. Save and approve.
    await savePersonaVerification(session.userId, {
      tier1: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        ...(requestId ? { inquiryId: requestId } : {}),
        ...(state ? { geoState: state } : {}),
      },
      verifiedIdentity,
    });

    return json({ approved: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[Verify Submit] Error:', err);
    return jsonError(err instanceof Error ? err.message : 'Verification failed', 500);
  }
}
