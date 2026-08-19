import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

const COLLECTION = 'pass_origin';

export type PassOrigin = 'spin_reward' | 'admin_grant' | 'house_bot';

// A wheel-won Jackpot/HOF pass is KNOWN to be that level at mint time (the wheel
// guaranteed it), unlike a normal pass whose level is only revealed when its
// league fills. We stamp that known level here so the marketplace can mark/treat
// the pass as JP/HOF before any league reveal.
export type PassWheelLevel = 'jackpot' | 'hof' | 'jackhof';

export interface PassOriginDoc {
  tokenId: string;
  origin: PassOrigin;
  ownerAtMint: string;
  txHash: string;
  mintedAt: FirebaseFirestore.Timestamp;
  reason?: string;
  level?: PassWheelLevel;
}

export async function recordPassOrigins(params: {
  tokenIds: string[];
  origin: PassOrigin;
  ownerAtMint: string;
  txHash: string;
  reason?: string;
  level?: PassWheelLevel;
}): Promise<void> {
  const { tokenIds, origin, ownerAtMint, txHash, reason, level } = params;
  if (tokenIds.length === 0) return;

  const db = getAdminFirestore();
  const batch = db.batch();
  const wallet = ownerAtMint.toLowerCase();
  const txHashLower = txHash.toLowerCase();

  for (const tokenId of tokenIds) {
    const ref = db.collection(COLLECTION).doc(tokenId);
    batch.set(
      ref,
      {
        tokenId,
        origin,
        ownerAtMint: wallet,
        txHash: txHashLower,
        mintedAt: FieldValue.serverTimestamp(),
        ...(reason ? { reason } : {}),
        ...(level ? { level } : {}),
      },
      { merge: false },
    );
  }
  await batch.commit();
}

/**
 * Returns the count of free-origin passes originally minted to a given wallet.
 * Note: this is "minted to this wallet", not "currently owned" — for accurate
 * ownership, cross-reference with on-chain balanceOf or the Go API's per-token
 * passType field.
 */
export async function countFreeOriginsByWallet(wallet: string): Promise<number> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .where('ownerAtMint', '==', wallet.toLowerCase())
    .count()
    .get();
  return snap.data().count;
}

export async function listFreeOriginTokenIds(wallet: string): Promise<string[]> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .where('ownerAtMint', '==', wallet.toLowerCase())
    .get();
  return snap.docs.map((d) => d.get('tokenId') as string);
}

/**
 * Free-origin check by TOKEN, independent of who holds it now. A free pass
 * (wheel / admin grant) stays free when it's transferred wallet-to-wallet —
 * the reconciler used to classify by `ownerAtMint === recipient`, which
 * relabelled a transferred free pass as PAID on the recipient (token 3356,
 * 2026-08-19) and would have let it earn paid-only promos.
 */
export async function filterFreeOriginTokenIds(tokenIds: Array<string | number>): Promise<Set<string>> {
  const free = new Set<string>();
  if (tokenIds.length === 0) return free;
  const db = getAdminFirestore();
  const ids = Array.from(new Set(tokenIds.map((t) => String(t))));
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await db.collection(COLLECTION).where('tokenId', 'in', chunk).get();
    snap.forEach((d) => free.add(String(d.get('tokenId'))));
  }
  return free;
}
