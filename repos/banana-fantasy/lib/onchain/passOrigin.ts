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
