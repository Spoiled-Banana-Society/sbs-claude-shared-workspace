import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { isSpinOnPurchaseEnabled } from '@/lib/featureFlags';
import { logger } from '@/lib/logger';
import { PURCHASE_SPINS_FIELD } from '@/lib/spinTypes';

const USERS_COLLECTION = 'v2_users';

/**
 * Grant one PURCHASE spin per paid pass.
 *
 * Purchase spins live in their own counter and pay wedge-minus-one, because the
 * buyer already owns the first draft (see lib/spinTypes.ts). Promo spins are a
 * separate stack and are untouched by this.
 *
 * No-ops entirely unless `SPIN_ON_PURCHASE=1`, which is what lets the rest of
 * the feature sit in the codebase dark: with nothing granting purchase spins,
 * nothing can ever take the subtract-1 settlement path.
 *
 * Best-effort by design — the on-chain mint has already happened by the time
 * this runs, so a failure here must never roll the purchase back. A missed
 * spin is recoverable; a reverted mint is not.
 *
 * ⚠️ Called from BOTH `bookkeepPaidMint` and `creditCardDeposit` — those two
 * already duplicate paid-mint bookkeeping and must stay in sync.
 */
export async function grantPurchaseSpins(userId: string, quantity: number): Promise<number> {
  if (!isSpinOnPurchaseEnabled()) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  const granted = Math.floor(quantity);
  try {
    const db = getAdminFirestore();
    await db.collection(USERS_COLLECTION).doc(userId).set(
      { [PURCHASE_SPINS_FIELD]: FieldValue.increment(granted) },
      { merge: true },
    );
    logger.info('purchaseSpins.granted', { userId, granted });
    return granted;
  } catch (e) {
    logger.warn('purchaseSpins.grant_failed', { userId, quantity: granted, err: (e as Error).message });
    return 0;
  }
}
