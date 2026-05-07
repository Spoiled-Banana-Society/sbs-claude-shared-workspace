export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { savePersonaVerification } from '@/lib/db-firestore';
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
//   2. Create a Didit session for our ID-only workflow
//   3. Upload the ID image to Didit's session
//   4. Wait for Didit to validate the document
//   5. Compare extracted fields against the form values
//   6. Run SBS-specific block rules (state/parish/age) on extracted data
//   7. Save verification + identity to Firestore
//   8. Return { approved: true } or { approved: false, reason }

const DIDIT_API_KEY = process.env.DIDIT_API_KEY || '';
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || '';
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
  if (!DIDIT_WORKFLOW_ID) return jsonError('Didit workflow ID not configured', 500);

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

    // Step 1: Create a Didit session bound to our workflow + this user.
    const sessionRes = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DIDIT_API_KEY,
      },
      body: JSON.stringify({
        workflow_id: DIDIT_WORKFLOW_ID,
        vendor_data: session.userId,
      }),
    });
    if (!sessionRes.ok) {
      const text = await sessionRes.text();
      console.error('[Verify Submit] Session create failed:', sessionRes.status, text);
      return jsonError('Failed to start verification', 502);
    }
    const sessionData = (await sessionRes.json()) as {
      session_id: string;
      session_token?: string;
    };
    const sessionId = sessionData.session_id;

    // Step 2: Upload the ID image to the session. Didit's document upload
    // endpoint accepts multipart with the image as `document_front`.
    const uploadForm = new FormData();
    uploadForm.append('document_front', idImage, idImage.name || 'id.jpg');

    const uploadRes = await fetch(
      `${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/document/upload/`,
      {
        method: 'POST',
        headers: {
          'x-api-key': DIDIT_API_KEY,
          // NOTE: don't set Content-Type — fetch sets multipart boundary
        },
        body: uploadForm,
      },
    );
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error('[Verify Submit] Document upload failed:', uploadRes.status, text);
      return jsonError('Failed to upload ID document', 502);
    }

    // Step 3: Poll session decision. Didit usually completes ID-only
    // verification in 5-15 seconds; we poll for up to 60s before giving up.
    let decision: 'Approved' | 'Declined' | 'In Progress' | 'Expired' = 'In Progress';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let extracted: any = {};
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const statusRes = await fetch(
        `${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/decision/`,
        { headers: { 'x-api-key': DIDIT_API_KEY } },
      );
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      decision = statusData.status;
      extracted = statusData;
      if (decision === 'Approved' || decision === 'Declined' || decision === 'Expired') break;
    }

    if (decision !== 'Approved') {
      return json({
        approved: false,
        reason:
          decision === 'Declined'
            ? "We couldn't verify the ID you uploaded. Please try a clearer photo of a valid government-issued ID."
            : 'Verification timed out. Please try again.',
      });
    }

    // Step 4: Cross-check extracted ID data against the user's form values.
    const idVer = extracted?.features?.id_verification ?? extracted?.id_verification ?? {};
    const docData = idVer?.document_data ?? idVer ?? {};

    const idFirstName: string | undefined =
      docData?.first_name || docData?.firstName || docData?.given_names;
    const idLastName: string | undefined =
      docData?.last_name || docData?.lastName || docData?.surname;
    const idDob: string | undefined =
      docData?.date_of_birth || docData?.dateOfBirth || docData?.dob;

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
    const verifiedIdentity = {
      firstName,
      lastName,
      dateOfBirth,
      address: {
        street,
        city,
        state,
        country,
        zip,
        // No parish in the form; if state is LA, the user must enter the
        // parish in `city` or we fall through (parish-rule will skip).
        // Future improvement: dedicated parish field for LA.
        parish: undefined,
      },
      sessionId,
      verifiedAt: new Date().toISOString(),
    };

    // Step 6: Run SBS block rules — banned states, parish, age, country.
    const blockResult = checkBlockRules(verifiedIdentity);
    if (blockResult.blocked) {
      // Save the verified identity even when blocked so we don't ask for
      // the same docs again next time. The cashout endpoint will hit the
      // same block rule and reject with the same reason.
      await savePersonaVerification(session.userId, {
        tier1: {
          verified: true,
          inquiryId: sessionId,
          verifiedAt: new Date().toISOString(),
          geoState: state,
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
        inquiryId: sessionId,
        verifiedAt: new Date().toISOString(),
        geoState: state,
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
