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
const OWNERSHIP_WINDOW_MS = 10 * 60 * 1000;

export interface WalletTrades {
  paidByToken: Map<string, number>;
  recentBuys: Array<{ tokenId: string; teamName: string | null }>;
  recentSells: Set<string>;
}

export async function getWalletTrades(wallet: string): Promise<WalletTrades> {
  const empty: WalletTrades = { paidByToken: new Map(), recentBuys: [], recentSells: new Set() };
  if (!isFirestoreConfigured() || !wallet) return empty;
  try {
    const snap = await getAdminFirestore()
      .collection(COLLECTION)
      .where('walletAddress', '==', wallet.toLowerCase())
      .orderBy('timestamp', 'desc')
      .limit(300)
      .get();

    const cutoff = Date.now() - OWNERSHIP_WINDOW_MS;
    const paidByToken = new Map<string, number>();
    const recentBuys: Array<{ tokenId: string; teamName: string | null }> = [];
    const recentSells = new Set<string>();

    for (const doc of snap.docs) {
      const d = doc.data();
      const tokenId = String(d.tokenId);
      const tsMs = d.timestamp?.toDate?.()?.getTime?.() ?? 0;
      if (d.type === 'buy') {
        if (!paidByToken.has(tokenId) && d.price != null) paidByToken.set(tokenId, Number(d.price));
        if (tsMs >= cutoff) recentBuys.push({ tokenId, teamName: d.teamName ?? null });
      } else if (d.type === 'sell' && tsMs >= cutoff) {
        recentSells.add(tokenId);
      }
    }
    return { paidByToken, recentBuys, recentSells };
  } catch (e) {
    logger.warn('activityOwnership.getWalletTrades_failed', { err: (e as Error).message });
    return empty;
  }
}
