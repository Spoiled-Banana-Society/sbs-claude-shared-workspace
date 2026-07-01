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

// Founder names — reserved so no one but Boris/Richard can claim them. Matched
// case-insensitively with separators (space/_/.-/) stripped, so "Boris Vagner",
// "boris.vagner", and "BorisVagner" all resolve to the same reserved key.
const FOUNDER_WALLETS = new Set([
  '0x438bbe98eed1dd2df244b007dab0583cc9be72e0', // Boris (admin/drafting)
  '0xd3301bc039faf4223da98bceb5fb81abc9399362', // Boris (old Privy login)
  '0x2e64db49fc597a731091471607f6cd0251d7eafb', // Richard
  '0x93e2dc5642722688b2c5431cd7b3584cd97ee175', // Boris (Vag Bros / heyooo — MetaMask locked out)
]);
const RESERVED_NAME_KEYS = new Set([
  'boris', 'borisvagner',
  'richard', 'richvagner', 'richardvagner', 'rich',
  'vagbros', 'vagbrothers', // reserved to Boris's two wallets only
]);
// Strip everything but letters+digits, lowercase — collapses separators so a
// reserved name can't be slipped through with a dot/underscore/hyphen.
function reservedKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type UsernameError = 'too_short' | 'too_long' | 'invalid_chars' | 'looks_like_wallet' | 'reserved' | 'taken';

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

  // Founder names are off-limits to everyone except Boris/Richard's own wallets.
  if (RESERVED_NAME_KEYS.has(reservedKey(name)) && !FOUNDER_WALLETS.has(self)) {
    return { available: false, reason: 'reserved' };
  }
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

  // Hard gate: founder names can only be claimed by Boris/Richard's own wallets.
  if (RESERVED_NAME_KEYS.has(reservedKey(name)) && !FOUNDER_WALLETS.has(self)) {
    return { available: false, reason: 'reserved' };
  }

  // Seed the user FIRST so the username we're about to mirror onto v2_users
  // always lands on a fully-seeded doc (promos/badges/welcome bell present).
  // Without this, a name claim that beats the lazy seed would write `username`
  // onto a bare doc — and ensureUserSeeded treats "has username" as "already
  // seeded", so the user would be permanently stuck with no promos/badges/bell.
  // Cheap for existing users (ensureUserSeeded bails immediately when the doc
  // already has a username). Lazy import avoids a module cycle with db-firestore.
  try {
    const { ensureUserSeeded } = await import('@/lib/db-firestore');
    await ensureUserSeeded(self);
  } catch { /* non-fatal — claim still proceeds; seed will heal on next read */ }

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
