import type { Firestore } from 'firebase-admin/firestore';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';

/**
 * Current holder of marketplace-bought teams (GatorMAB 2026-09-22).
 *
 * The scorer credits a team to its DRAFTER forever, so a bought team kept showing the seller's name on the
 * leaderboard and in the league popup. The marketplace buy log is tiny (~140 rows), so we read it once per 5 min
 * and, for just those tokens, confirm the current holder on-chain (one ownerOf per bought token, memoized 10 min).
 * Everything that was never traded costs nothing here. Display-only: scoring, ranks and prize payouts are untouched
 * (prizes already pay the on-chain owner).
 */
let buyersMemo: { at: number; byToken: Map<string, string> } | null = null;

export async function marketplaceBuyers(db: Firestore): Promise<Map<string, string>> {
  if (buyersMemo && Date.now() - buyersMemo.at < 5 * 60_000) return buyersMemo.byToken;
  const byToken = new Map<string, string>();
  const at = new Map<string, number>();
  try {
    const snap = await db.collection('marketplace_activity').where('type', '==', 'buy').select('tokenId', 'walletAddress', 'timestamp').get();
    for (const d of snap.docs) {
      const x = d.data() as { tokenId?: unknown; walletAddress?: unknown; timestamp?: { toDate?: () => Date } };
      const t = String(x.tokenId ?? '');
      const w = String(x.walletAddress ?? '').toLowerCase();
      const ts = x.timestamp?.toDate?.()?.getTime?.() ?? 0;
      if (!/^\d+$/.test(t) || !/^0x[0-9a-f]{40}$/.test(w)) continue;
      if (ts >= (at.get(t) ?? -1)) { byToken.set(t, w); at.set(t, ts); }
    }
  } catch { /* overlay is best-effort */ }
  buyersMemo = { at: Date.now(), byToken };
  return byToken;
}

const onchainMemo = new Map<string, { at: number; owner: string | null }>();

export async function confirmedHolder(tokenId: string, fallback: string): Promise<string> {
  const hit = onchainMemo.get(tokenId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.owner ?? fallback;
  const owner = await getOnchainOwner(tokenId);
  onchainMemo.set(tokenId, { at: Date.now(), owner });
  return owner ?? fallback;
}

/** tokenId → current holder, only for tokens that were ever bought on the marketplace. */
export async function resolveHolders(db: Firestore, tokenIds: Iterable<string>): Promise<Map<string, string>> {
  const buyers = await marketplaceBuyers(db);
  const out = new Map<string, string>();
  if (!buyers.size) return out;
  const wanted = Array.from(new Set(Array.from(tokenIds).filter((t) => buyers.has(t))));
  await Promise.all(wanted.map(async (t) => { out.set(t, await confirmedHolder(t, buyers.get(t)!)); }));
  return out;
}
