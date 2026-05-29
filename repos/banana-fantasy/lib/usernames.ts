/**
 * Unique username enforcement.
 *
 * Usernames must be unique (case-insensitive). The source of truth for "is
 * this name taken" is a small reservation collection:
 *
 *   usernames/{username_lower} = { walletAddress, name, updatedAt }
 *
 * `claimUsername` reserves a name in a transaction — rejecting it if another
 * wallet already holds it — and releases the caller's previous reservation. It
 * also mirrors the name onto v2_users (username + username_lower) so the rest
 * of the app (friends, chat, search) reflects it immediately and so the
 * lower-cased index stays consistent.
 *
 * NOTE: the Go backend is the canonical owner display-name store. This gate
 * enforces uniqueness for every path the frontend uses; for fully bypass-proof
 * uniqueness the Go API write should enforce it too (flagged in handoff).
 */

import { getAdminFirestore } from '@/lib/firebaseAdmin';

const RESERVATIONS = 'usernames';
const USERS = 'v2_users';

const MIN_LEN = 3;
const MAX_LEN = 20;
// Letters, numbers, underscore, dot, hyphen. No spaces — keeps names @-able.
const ALLOWED = /^[a-zA-Z0-9_.-]+$/;

export type UsernameError = 'too_short' | 'too_long' | 'invalid_chars' | 'looks_like_wallet' | 'taken';

export interface UsernameCheck {
  available: boolean;
  reason?: UsernameError;
}

/** Format validation shared by check + claim. Returns null when the shape is OK. */
export function validateUsernameShape(name: string): UsernameError | null {
  const t = name.trim();
  if (t.length < MIN_LEN) return 'too_short';
  if (t.length > MAX_LEN) return 'too_long';
  if (!ALLOWED.test(t)) return 'invalid_chars';
  // Don't let people set a wallet-shaped name (collides with our default form).
  if (/^0x[0-9a-fA-F]{4,}/.test(t)) return 'looks_like_wallet';
  return null;
}

/**
 * Is `name` available for `selfWallet`? Available means: valid shape, and not
 * reserved by a *different* wallet (checks both the reservation collection and
 * any existing v2_users doc with that username_lower).
 */
export async function checkUsername(name: string, selfWallet: string): Promise<UsernameCheck> {
  const shape = validateUsernameShape(name);
  if (shape) return { available: false, reason: shape };

  const lower = name.trim().toLowerCase();
  const self = selfWallet.toLowerCase();
  const db = getAdminFirestore();

  const resSnap = await db.collection(RESERVATIONS).doc(lower).get();
  if (resSnap.exists) {
    const owner = String((resSnap.data() as { walletAddress?: string })?.walletAddress || '').toLowerCase();
    if (owner && owner !== self) return { available: false, reason: 'taken' };
    return { available: true };
  }

  // No reservation yet — also guard against legacy names already in v2_users
  // (reservations are new; older names predate them).
  const dupe = await db.collection(USERS)
    .where('username_lower', '==', lower)
    .limit(2)
    .get();
  const takenByOther = dupe.docs.some((d) => d.id.toLowerCase() !== self);
  if (takenByOther) return { available: false, reason: 'taken' };

  return { available: true };
}

/**
 * Atomically reserve `name` for `selfWallet`. Rejects if another wallet holds
 * it. Releases the caller's previous reservation and mirrors the name onto
 * v2_users. Returns the same shape as checkUsername.
 */
export async function claimUsername(name: string, selfWallet: string): Promise<UsernameCheck> {
  const shape = validateUsernameShape(name);
  if (shape) return { available: false, reason: shape };

  const cleanName = name.trim();
  const lower = cleanName.toLowerCase();
  const self = selfWallet.toLowerCase();
  const db = getAdminFirestore();

  const resRef = db.collection(RESERVATIONS).doc(lower);
  const userRef = db.collection(USERS).doc(self);

  try {
    await db.runTransaction(async (tx) => {
      const [resSnap, userSnap] = await Promise.all([tx.get(resRef), tx.get(userRef)]);

      if (resSnap.exists) {
        const owner = String((resSnap.data() as { walletAddress?: string })?.walletAddress || '').toLowerCase();
        if (owner && owner !== self) throw new Error('taken');
      } else {
        // Guard against a legacy v2_users dupe that has no reservation yet.
        const dupe = await db.collection(USERS).where('username_lower', '==', lower).limit(2).get();
        if (dupe.docs.some((d) => d.id.toLowerCase() !== self)) throw new Error('taken');
      }

      // Release the caller's old reservation if they're renaming.
      const prevLower = String((userSnap.data() as { username_lower?: string })?.username_lower || '');
      if (prevLower && prevLower !== lower) {
        const prevRef = db.collection(RESERVATIONS).doc(prevLower);
        const prevSnap = await tx.get(prevRef);
        const prevOwner = String((prevSnap.data() as { walletAddress?: string })?.walletAddress || '').toLowerCase();
        if (prevOwner === self) tx.delete(prevRef);
      }

      tx.set(resRef, { walletAddress: self, name: cleanName, updatedAt: Date.now() });
      tx.set(userRef, { username: cleanName, username_lower: lower }, { merge: true });
    });
    return { available: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'taken') return { available: false, reason: 'taken' };
    throw err;
  }
}
