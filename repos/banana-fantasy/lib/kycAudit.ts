// KYC verification audit log.
// Every attempt — successful or failed — gets a row in `kyc_attempts` with
// the form data, Didit response, block-rule outcome, and an identity hash
// (for future sybil detection). Admin can browse this via /api/admin/kyc-attempts.
//
// Identity hash is sha256(firstName|lastName|dob). Same person, same hash,
// regardless of wallet. When sybil detection is turned on (next session),
// we'll reject new verifications whose hash already maps to a different
// userId in this collection.

import crypto from 'crypto';
import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';

const KYC_COLLECTION = 'kyc_attempts';

export type KycAttemptStatus =
  | 'approved'
  | 'didit_declined'      // Didit rejected the document
  | 'name_mismatch'       // Didit approved but name on ID didn't match form
  | 'dob_mismatch'        // Didit approved but DOB didn't match form
  | 'blocked'             // SBS block rule rejected (state/parish/age/country)
  | 'error'               // backend / network error
  | 'invalid_input';      // form validation failed before reaching Didit

export interface KycAttemptFormData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  country: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface KycAttemptDiditData {
  requestId?: string;
  status?: string;
  extractedFirstName?: string;
  extractedLastName?: string;
  extractedDob?: string;
  documentType?: string;
  documentNumber?: string;
  warnings?: string[];
}

export interface KycAttempt {
  userId: string;
  walletAddress?: string;
  timestamp: string;
  status: KycAttemptStatus;
  formData: KycAttemptFormData;
  didit?: KycAttemptDiditData;
  // Set when status === 'blocked'
  blockCode?: string;
  blockReason?: string;
  // Set when status === 'error'
  errorMessage?: string;
  // Always set (when we have name+DOB) — used for sybil detection later
  identityHash?: string;
  // Image size / processing diagnostics
  imageSizeKb?: number;
  durationMs?: number;
}

/**
 * Hash a person's identity to a stable id. Same first/last/DOB → same hash,
 * regardless of capitalisation, whitespace, or wallet. Used for sybil
 * detection — if we ever see this hash mapped to a DIFFERENT userId we know
 * the same person verified two wallets.
 */
export function buildIdentityHash(
  firstName: string,
  lastName: string,
  dob: string,
): string {
  const f = firstName.trim().toLowerCase();
  const l = lastName.trim().toLowerCase();
  const d = dob.slice(0, 10); // YYYY-MM-DD
  return crypto.createHash('sha256').update(`${f}|${l}|${d}`, 'utf8').digest('hex');
}

/**
 * Log a KYC attempt. Fire-and-forget — never blocks the verification flow.
 * Caught errors are logged to console but don't propagate to the caller.
 */
export async function logKycAttempt(attempt: Omit<KycAttempt, 'timestamp'>): Promise<void> {
  if (!isFirestoreConfigured()) {
    console.warn('[KYC Audit] Firestore not configured, skipping log');
    return;
  }
  try {
    const db = getAdminFirestore();
    await db.collection(KYC_COLLECTION).add({
      ...attempt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[KYC Audit] Failed to log attempt:', err);
  }
}

/**
 * Find any prior approved attempt with the same identity hash but a
 * different userId. Returns the offending userId, or null if no conflict.
 * Used for sybil detection at verification time (currently logged-only,
 * not enforced — turn on enforcement when we're confident in the data).
 */
export async function findIdentityCollision(
  identityHash: string,
  currentUserId: string,
): Promise<{ userId: string; walletAddress?: string } | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const snap = await db
      .collection(KYC_COLLECTION)
      .where('identityHash', '==', identityHash)
      .where('status', '==', 'approved')
      .limit(10)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data() as KycAttempt;
      if (data.userId !== currentUserId) {
        return { userId: data.userId, walletAddress: data.walletAddress };
      }
    }
    return null;
  } catch (err) {
    console.error('[KYC Audit] findIdentityCollision failed:', err);
    return null;
  }
}

/**
 * List recent KYC attempts. Default 50 most-recent, filterable by status.
 * Admin endpoint surfaces this.
 */
export async function listKycAttempts(opts: {
  limit?: number;
  status?: KycAttemptStatus;
  userId?: string;
}): Promise<Array<KycAttempt & { id: string }>> {
  if (!isFirestoreConfigured()) return [];
  try {
    const db = getAdminFirestore();
    let q = db.collection(KYC_COLLECTION).orderBy('timestamp', 'desc');
    if (opts.status) q = q.where('status', '==', opts.status);
    if (opts.userId) q = q.where('userId', '==', opts.userId);
    const snap = await q.limit(opts.limit ?? 50).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as KycAttempt) }));
  } catch (err) {
    console.error('[KYC Audit] listKycAttempts failed:', err);
    return [];
  }
}
