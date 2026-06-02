/**
 * Per-user "client state" — small account-level flags that used to live in
 * localStorage (per-device) but should follow the user across devices:
 * onboarding/tutorial completion, "promo seen/dismissed" flags, chat read
 * timestamps, cashout-returning, notification opt-in cooldown, etc.
 *
 * Stored as a single merge-able doc at v2_users/{userId}/metadata/clientState
 * (same pattern as the referral/exposure metadata docs). Read/written through
 * /api/user/client-state and consumed client-side via hooks/useSyncedFlag.
 *
 * These flags are non-sensitive (booleans / timestamps about UI progress), so
 * the API is wallet-scoped without heavy auth, matching the existing
 * notification + owner endpoints.
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const USERS_COLLECTION = 'v2_users';
const META_SUBCOLLECTION = 'metadata';
const CLIENT_STATE_DOC = 'clientState';

export type ClientStateValue = boolean | number | string | null;

export async function getClientState(userId: string): Promise<Record<string, ClientStateValue>> {
  if (!isFirestoreConfigured() || !userId) return {};
  try {
    const db = getAdminFirestore();
    const snap = await db
      .collection(USERS_COLLECTION)
      .doc(userId.toLowerCase())
      .collection(META_SUBCOLLECTION)
      .doc(CLIENT_STATE_DOC)
      .get();
    return snap.exists ? (snap.data() as Record<string, ClientStateValue>) : {};
  } catch (err) {
    console.error('[clientState] get failed:', err);
    return {};
  }
}

export async function setClientFlag(userId: string, key: string, value: ClientStateValue): Promise<void> {
  if (!isFirestoreConfigured() || !userId || !key) return;
  try {
    const db = getAdminFirestore();
    await db
      .collection(USERS_COLLECTION)
      .doc(userId.toLowerCase())
      .collection(META_SUBCOLLECTION)
      .doc(CLIENT_STATE_DOC)
      .set({ [key]: value }, { merge: true });
  } catch (err) {
    console.error('[clientState] set failed:', err);
  }
}
