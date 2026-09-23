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

/**
 * Nightly on-chain sweep overlay (app/api/crons/holders-sweep): tokenId → holder for every card whose on-chain owner
 * ≠ the drafter, whatever the venue (OpenSea, gifts, our marketplace). Small collection (~150 docs), read once per 5 min.
 */
let sweepMemo: { at: number; byToken: Map<string, string> } | null = null;
export async function sweptHolders(db: Firestore): Promise<Map<string, string>> {
  if (sweepMemo && Date.now() - sweepMemo.at < 5 * 60_000) return sweepMemo.byToken;
  const byToken = new Map<string, string>();
  try {
    const snap = await db.collection('token_holders').select('holder').get();
    for (const d of snap.docs) { const h = String((d.data() as { holder?: unknown }).holder ?? '').toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(h)) byToken.set(d.id, h); }
  } catch { /* best-effort */ }
  sweepMemo = { at: Date.now(), byToken };
  return byToken;
}

/**
 * tokenId → current holder for tokens known to have changed hands: marketplace buys (confirmed on-chain, so a
 * same-day resale shows the newest owner) plus last night's sweep. Never-traded tokens are omitted (zero cost).
 */
export async function resolveHolders(db: Firestore, tokenIds: Iterable<string>): Promise<Map<string, string>> {
  const [buyers, swept] = await Promise.all([marketplaceBuyers(db), sweptHolders(db)]);
  const out = new Map<string, string>();
  const ids = Array.from(new Set(Array.from(tokenIds)));
  for (const t of ids) { const h = swept.get(t); if (h) out.set(t, h); }
  const fresh = ids.filter((t) => buyers.has(t));
  await Promise.all(fresh.map(async (t) => { out.set(t, await confirmedHolder(t, buyers.get(t)!)); }));
  return out;
}
