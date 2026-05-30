/**
 * Pass ledger — the single source of truth for how many draft passes a wallet
 * actually has.
 *
 * The hard rule this module enforces: the user-facing counters
 * (`v2_users/{wallet}.draftPasses` / `.freeDrafts`) are a *mirror* of the real
 * spendable token inventory the draft engine consumes from
 * (`owners/{wallet}/validDraftTokens`), NOT a number anyone blindly increments.
 *
 * Both collections live in the same Firestore (sbs-staging-env), and
 * `validDraftTokens` is the exact collection the Go engine's `JoinLeagues`
 * spends from. So counting it and writing the counter to that count makes the
 * counter impossible to drift above reality: after every mint/grant we recount,
 * and the number is whatever really landed — never a phantom +1.
 *
 * Why a recount (SET) instead of an increment: an increment accumulates error
 * every time a downstream write silently fails. A recount is idempotent and
 * self-healing — it always converges to the truth no matter how it's called.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { addActivityEventToTx, type buildActivityEventDoc } from '@/lib/activityEvents';

const USERS_COLLECTION = 'v2_users';

export interface InventoryCounts {
  /** Spendable paid tokens (legacy/empty passType folds to paid — matches the engine). */
  paid: number;
  /** Spendable free tokens (wheel-won / admin-granted). */
  free: number;
}

/**
 * Counts a wallet's real spendable tokens in `owners/{wallet}/validDraftTokens`,
 * split by passType. This is the SAME collection the Go engine's `JoinLeagues`
 * reads, so it is the authoritative answer to "how many passes can this wallet
 * actually use right now". An empty/legacy `PassType` folds to `paid`, exactly
 * as the engine's `normalizePassType` does.
 */
export async function countSpendableTokens(wallet: string): Promise<InventoryCounts> {
  const db = getAdminFirestore();
  const w = wallet.toLowerCase();
  const snap = await db.collection(`owners/${w}/validDraftTokens`).get();
  let paid = 0;
  let free = 0;
  snap.forEach((doc) => {
    const data = doc.data() as { PassType?: string; passType?: string };
    const pt = String(data.PassType ?? data.passType ?? '').toLowerCase();
    if (pt === 'free') free += 1;
    else paid += 1;
  });
  return { paid, free };
}

/**
 * Writes `draftPasses`/`freeDrafts` on `v2_users/{wallet}` to the REAL spendable
 * token counts — a mirror of inventory, not an increment. Call after any path
 * that adds or removes tokens (mint, grant, spin reward, reconcile). The counter
 * can never end up higher than the tokens that actually exist.
 *
 * Optionally writes an audit row in the same transaction (same convention as
 * the rest of the pass paths), so the activity feed and the counter agree.
 */
export async function recountFromInventory(
  wallet: string,
  activityDoc?: Awaited<ReturnType<typeof buildActivityEventDoc>>,
): Promise<{ draftPasses: number; freeDrafts: number }> {
  const db = getAdminFirestore();
  const w = wallet.toLowerCase();
  const { paid, free } = await countSpendableTokens(w);
  const userRef = db.collection(USERS_COLLECTION).doc(w);
  await db.runTransaction(async (tx) => {
    tx.set(
      userRef,
      {
        draftPasses: paid,
        freeDrafts: free,
        walletAddress: w,
        passesSyncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (activityDoc) addActivityEventToTx(tx, activityDoc);
  });
  return { draftPasses: paid, freeDrafts: free };
}
