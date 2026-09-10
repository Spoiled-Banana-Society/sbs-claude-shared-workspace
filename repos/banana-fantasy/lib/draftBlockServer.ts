import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { DRAFT_BLOCKED_MESSAGE } from '@/lib/draftBlock';
import { isDraftingOpen, PASS_SALES_CLOSED_MESSAGE } from '@/lib/draftTypes';

/**
 * Server half of the admin drafting block — see lib/draftBlock.ts.
 * Fail-open on read errors (never let a Firestore hiccup block a join).
 */
export async function isWalletDraftBlocked(wallet: string | null | undefined): Promise<boolean> {
  if (!wallet || !isFirestoreConfigured()) return false;
  try {
    const doc = await getAdminFirestore().collection('v2_users').doc(wallet.toLowerCase()).get();
    return doc.data()?.draftBlocked === true;
  } catch {
    return false;
  }
}

export async function assertWalletCanDraft(wallet: string | null | undefined): Promise<void> {
  // Season close (Richard 2026-09-09): from 4 PM PT kickoff day no pass can be
  // bought or minted and no draft joined — every purchase/join route calls this.
  if (!isDraftingOpen()) throw new ApiError(410, PASS_SALES_CLOSED_MESSAGE);
  if (await isWalletDraftBlocked(wallet)) throw new ApiError(403, DRAFT_BLOCKED_MESSAGE);
}
