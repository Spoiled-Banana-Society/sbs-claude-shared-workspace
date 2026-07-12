import { ethers } from 'ethers';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { logger } from '@/lib/logger';

export const BOT_COLLECTION = 'botWallets';

/**
 * Mint one REAL on-chain free pass to a house-bot wallet and record it in the
 * `botWallets` registry. Shared by /api/admin/bots/mint and /api/admin/bots/fill.
 *
 * Two modes:
 *  - no `address`: creates a brand-new bot — fresh random wallet with NO key
 *    stored anywhere (bots are fully server-operated and can never be logged
 *    into), mints the pass to it, registers it.
 *  - with `address`: tops up an EXISTING pool bot with another pass. Bots are
 *    reusable across drafts — one pass per draft, and the engine's join
 *    transaction rejects a second seat in the SAME draft — so a retired bot
 *    (team drafted, no spendable pass) gets back in rotation this way.
 *
 * On-chain this is identical to any real free-draft player's pass (owner
 * reserveTokens -> wallet), and the token registers as `free` in the Go engine
 * so it never touches paid stats, promos, King of the Hill, or badges.
 */
export async function mintBotPass(
  db: Firestore,
  address?: string,
): Promise<{ address: string; tokenIds: string[]; txHash: string }> {
  const isTopUp = Boolean(address);
  const addr = (address ?? ethers.Wallet.createRandom().address).toLowerCase();

  const { txHash, tokenIds } = await reserveTokensToWallet({ to: addr, count: 1 });
  const idStrs = tokenIds.map((t) => String(t));
  try {
    await registerMintedTokens(addr, tokenIds, 'free');
  } catch (e) {
    logger.warn('bots.mint.register_failed', { address: addr, err: (e as Error).message });
  }

  const doc: Record<string, unknown> = {
    isBot: true,
    address: addr,
    tokenIds: FieldValue.arrayUnion(...idStrs),
    passType: 'free',
    mintTxHash: txHash,
    lastMintAt: Date.now(),
  };
  if (!isTopUp) doc.createdAt = Date.now();
  await db.collection(BOT_COLLECTION).doc(addr).set(doc, { merge: true });

  return { address: addr, tokenIds: idStrs, txHash };
}
