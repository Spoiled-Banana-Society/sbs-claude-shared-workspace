export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { savePersonaVerification, type VerifiedIdentity } from '@/lib/db-firestore';
import { checkBlockRules } from '@/lib/verifyBlockRules';
import { buildIdentityHash, logKycAttempt } from '@/lib/kycAudit';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

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
  const startMs = Date.now();
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  if (!DIDIT_API_KEY) return jsonError('Didit API key not configured', 500);

  let userId = '';
  let walletAddress: string | undefined;
  // Capture form values for audit log even when validation rejects them.
  const formData = {
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    country: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  };
  let identityHash: string | undefined;
  let imageSizeKb = 0;

  try {
    const session = await getPrivyUser(req);
    walletAddress = session.walletAddress ?? undefined;
    // Use wallet address (lowercase) as the canonical Firestore key to match
    // the rest of the system. /api/eligibility reads under walletAddress (the
    // /prizes page passes user.walletAddress); v2_users etc. all key on
    // walletAddress. Saving under the Privy DID would create orphan docs the
    // eligibility view can't find. Fall back to Privy userId only when the
    // user has no wallet at all (shouldn't happen for cashout — Coinbase needs
    // a wallet — but defensive).
    userId = (walletAddress ?? session.userId).toLowerCase();

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

    Object.assign(formData, { firstName, lastName, dateOfBirth, country, street, city, state, zip });
    if (firstName && lastName && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      identityHash = buildIdentityHash(firstName, lastName, dateOfBirth);
    }

    // Validation. Each early-return logs an `invalid_input` audit row so
    // we can see what users were tripping on (missing fields, bad dates,
    // wrong country, oversized file, etc.).
    const failInvalidInput = async (msg: string, status = 400) => {
      await logKycAttempt({
        userId, walletAddress, status: 'invalid_input',
        formData, identityHash, errorMessage: msg,
        durationMs: Date.now() - startMs,
      });
      return jsonError(msg, status);
    };

    if (!firstName || !lastName) return failInvalidInput('Name is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return failInvalidInput('Date of birth must be YYYY-MM-DD');
    }
    if (country !== 'US' && country !== 'CA') {
      return failInvalidInput('Country must be US or CA');
    }
    if (!street || !city || !state || !zip) {
      return failInvalidInput('Address is required');
    }
    if (!(idImage instanceof File)) {
      return failInvalidInput('ID image is required');
    }
    if (idImage.size > MAX_ID_FILE_SIZE) {
      return failInvalidInput('ID image exceeds 10MB limit');
    }
    if (idImage.type && !ALLOWED_MIME_TYPES.has(idImage.type)) {
      return failInvalidInput('ID image must be JPG, PNG, HEIC, or WEBP');
    }
    imageSizeKb = Math.round(idImage.size / 1024);

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
      logger.error(LOG_SOURCES.kyc.DIDIT_API_FAILED, {
        route: '/api/verify/submit',
        userId,
        walletAddress,
        status: verifyRes.status,
        responseBody: text.slice(0, 500),
      });
      await logKycAttempt({
        userId, walletAddress, status: 'error',
        formData, identityHash, imageSizeKb,
        errorMessage: `Didit API ${verifyRes.status}: ${text.slice(0, 500)}`,
        durationMs: Date.now() - startMs,
      });
      // Didit rejects some formats (notably HEIC, iPhone's default). The client
      // converts HEIC→JPEG when it can, but as a backstop give a format-specific
      // message instead of the misleading "try a clearer photo" when that's the
      // actual cause — otherwise iPhone users loop forever on a fine photo.
      const isFormatError = /extension|not allowed|file type|unsupported|invalid.*image/i.test(text);
      return jsonError(
        isFormatError
          ? 'That image format isn\'t supported. Please upload a JPG or PNG (a screenshot of your ID works).'
          : 'Failed to verify ID. Please try a clearer photo of your driver\'s license, passport, or state ID.',
        502,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verifyData = await verifyRes.json() as any;
    const idVer = verifyData?.id_verification ?? {};
    const decision: string = idVer?.status || 'Declined';
    const requestId: string | undefined = verifyData?.request_id;
    const idFirstName: string | undefined = idVer?.first_name;
    const idLastName: string | undefined = idVer?.last_name;
    const idDob: string | undefined = idVer?.date_of_birth;
    const idWarnings: string[] = Array.isArray(idVer?.warnings) ? idVer.warnings : [];
    const diditAuditData = {
      requestId,
      status: decision,
      extractedFirstName: idFirstName,
      extractedLastName: idLastName,
      extractedDob: idDob,
      documentType: idVer?.document_type,
      documentNumber: idVer?.document_number,
      warnings: idWarnings.length > 0 ? idWarnings : undefined,
    };

    if (decision !== 'Approved') {
      const detail = idWarnings.length > 0 ? ` (${idWarnings.join(', ')})` : '';
      await logKycAttempt({
        userId, walletAddress, status: 'didit_declined',
        formData, didit: diditAuditData, identityHash, imageSizeKb,
        durationMs: Date.now() - startMs,
      });
      return json({
        approved: false,
        reason: `We couldn't verify the ID you uploaded${detail}. Please try a clearer photo of a valid government-issued ID.`,
      });
    }

    // Step 2: Cross-check extracted ID data against the user's form values.

    if (!nameMatches(firstName, idFirstName) || !nameMatches(lastName, idLastName)) {
      await logKycAttempt({
        userId, walletAddress, status: 'name_mismatch',
        formData, didit: diditAuditData, identityHash, imageSizeKb,
        durationMs: Date.now() - startMs,
      });
      return json({
        approved: false,
        reason:
          "The name on your ID doesn't match the name you entered. Please verify both fields and try again.",
      });
    }
    if (!dobMatches(dateOfBirth, idDob)) {
      await logKycAttempt({
        userId, walletAddress, status: 'dob_mismatch',
        formData, didit: diditAuditData, identityHash, imageSizeKb,
        durationMs: Date.now() - startMs,
      });
      return json({
        approved: false,
        reason:
          "The date of birth on your ID doesn't match what you entered. Please verify and try again.",
      });
    }

    // Sybil check (logged-only for now). If this identity hash already maps
    // to a different userId in our audit log, flag it. Enforcement (rejecting
    // the verification) is gated off until we've reviewed the data and are
    // confident in the match logic. For now we just log a warning so the
    // admin can spot multi-account attempts.
    if (identityHash) {
      const { findIdentityCollision } = await import('@/lib/kycAudit');
      const collision = await findIdentityCollision(identityHash, userId);
      if (collision) {
        console.warn(
          '[KYC Sybil] Identity hash collision detected — userId',
          userId,
          'matches existing approved userId',
          collision.userId,
          'wallet',
          collision.walletAddress,
        );
        // Future enforcement: return json({ approved: false, reason: '...' })
        // and log status: 'sybil_blocked'. For now just continue + log.
      }
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
      await savePersonaVerification(userId, {
        tier1: {
          verified: true,
          verifiedAt: new Date().toISOString(),
          ...(requestId ? { inquiryId: requestId } : {}),
          ...(state ? { geoState: state } : {}),
        },
        verifiedIdentity,
      });
      await logKycAttempt({
        userId, walletAddress, status: 'blocked',
        formData, didit: diditAuditData, identityHash, imageSizeKb,
        blockCode: blockResult.code,
        blockReason: blockResult.message,
        durationMs: Date.now() - startMs,
      });
      return json({
        approved: false,
        reason: blockResult.message || 'Verification not permitted in your jurisdiction.',
        blockCode: blockResult.code,
      });
    }

    // Step 7: All checks passed. Save and approve.
    // CRITICAL: save under the canonical key (lowercase wallet from line
    // 100), NOT session.userId. session.userId is the Privy DID, which
    // doesn't match what /api/eligibility queries with — that's the bug
    // that left users showing "Verification Required" after a successful
    // KYC. Block branch above already does this correctly; success branch
    // had the leftover.
    await savePersonaVerification(userId, {
      tier1: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        ...(requestId ? { inquiryId: requestId } : {}),
        ...(state ? { geoState: state } : {}),
      },
      verifiedIdentity,
    });

    await logKycAttempt({
      userId, walletAddress, status: 'approved',
      formData, didit: diditAuditData, identityHash, imageSizeKb,
      durationMs: Date.now() - startMs,
    });

    return json({ approved: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[Verify Submit] Error:', err);
    // Log the unexpected error to the audit so admin can see what blew up.
    if (userId) {
      await logKycAttempt({
        userId, walletAddress, status: 'error',
        formData, identityHash, imageSizeKb,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      });
    }
    return jsonError(err instanceof Error ? err.message : 'Verification failed', 500);
  }
}
