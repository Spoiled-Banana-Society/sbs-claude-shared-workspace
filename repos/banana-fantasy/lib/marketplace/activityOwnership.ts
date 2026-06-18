import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Derives a wallet's recent trading state from the marketplace_activity log so
 * the marketplace can reflect a buy/sell instantly, ahead of OpenSea's account
 * index (which lags minutes behind a sale). One query powers three things:
 *  - paidByToken: what the wallet paid for each team it bought ("You paid $X").
 *  - recentBuys:  teams bought in the freshness window → add to My Teams now.
 *  - recentSells: teams sold in the freshness window → drop from My Teams now.
 * Overlay add/remove is always re-confirmed on-chain by the caller, so a stale
 * log entry can never wrongly add or hide a team.
 */

const COLLECTION = 'marketplace_activity';
// How long a buy/sell stays in the overlay that adds/removes a team from My
// Teams ahead of OpenSea's lagging by-owner index. 24h, not 10min: OpenSea can
// take well over 10 minutes to drop a sold NFT from the seller's account view,
// and once that overlay expired a sold team would REAPPEAR in the seller's Sell
// tab (seen with token #176 ~76min after sale). Safe to keep long because the
// caller ALWAYS re-confirms on-chain ownerOf before hiding/adding (a stale log
// row can never wrongly hide a team you still own or add one you don't).
const OWNERSHIP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WalletTrades {
  paidByToken: Map<string, number>;
  recentBuys: Array<{ tokenId: string; teamName: string | null }>;
  recentSells: Set<string>;
}

export async function getWalletTrades(wallet: string): Promise<WalletTrades> {
  const empty: WalletTrades = { paidByToken: new Map(), recentBuys: [], recentSells: new Set() };
  if (!isFirestoreConfigured() || !wallet) return empty;
  try {
    // Single-field equality only — no composite (walletAddress + timestamp)
    // index needed. Sort newest-first in memory; a wallet's trade count is small.
    const snap = await getAdminFirestore()
      .collection(COLLECTION)
      .where('walletAddress', '==', wallet.toLowerCase())
      .get();

    const cutoff = Date.now() - OWNERSHIP_WINDOW_MS;
    const paidByToken = new Map<string, number>();
    const paidAtByToken = new Map<string, number>();
    const recentBuys: Array<{ tokenId: string; teamName: string | null }> = [];
    const recentSells = new Set<string>();

    for (const doc of snap.docs) {
      const d = doc.data();
      const tokenId = String(d.tokenId);
      const tsMs = d.timestamp?.toDate?.()?.getTime?.() ?? 0;
      if (d.type === 'buy') {
        // Keep the most recent buy price per token.
        if (d.price != null && tsMs >= (paidAtByToken.get(tokenId) ?? -1)) {
          paidByToken.set(tokenId, Number(d.price));
          paidAtByToken.set(tokenId, tsMs);
        }
        if (tsMs >= cutoff) recentBuys.push({ tokenId, teamName: d.teamName ?? null });
      } else if (d.type === 'sell' && tsMs >= cutoff) {
        recentSells.add(tokenId);
      } else if (d.type === 'offer_accepted' && tsMs >= cutoff) {
        // A team sold by accepting an offer: the acceptor (this walletAddress)
        // is the SELLER. Drop it from their My Teams instantly, same as a 'sell'.
        // (Newer sales log a real buy+sell pair; this covers legacy rows.)
        recentSells.add(tokenId);
      }
    }
    return { paidByToken, recentBuys, recentSells };
  } catch (e) {
    logger.warn('activityOwnership.getWalletTrades_failed', { err: (e as Error).message });
    return empty;
  }
}
