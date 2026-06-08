import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

const COLLECTION = 'pass_origin';

export type PassOrigin = 'spin_reward' | 'admin_grant';

export interface PassOriginDoc {
  tokenId: string;
  origin: PassOrigin;
  ownerAtMint: string;
  txHash: string;
  mintedAt: FirebaseFirestore.Timestamp;
  reason?: string;
}

export async function recordPassOrigins(params: {
  tokenIds: string[];
  origin: PassOrigin;
  ownerAtMint: string;
  txHash: string;
  reason?: string;
}): Promise<void> {
  const { tokenIds, origin, ownerAtMint, txHash, reason } = params;
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
