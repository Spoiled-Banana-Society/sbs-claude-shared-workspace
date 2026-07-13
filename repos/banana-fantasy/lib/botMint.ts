import { ethers } from 'ethers';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
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
 * so it never touches paid stats, promos, King of the Hill, or badges. Origin
 * is recorded in pass_origin so revenue/paid-vs-free reports classify bot
 * tokens correctly instead of as unknown mints.
 *
 * Go registration failure is a HARD error (2026-07-12): the pass exists
 * on-chain but the engine can't spend it, so silently continuing would let
 * every retry mint another orphan pass — the exact wasted-mint pattern that
 * looks suspicious on-chain. The orphan tokenIds are recorded durably on the
 * bot's registry doc (`unregisteredTokenIds`) and the fill route refuses to
 * mint anything while any orphan exists.
 */
export async function mintBotPass(
  db: Firestore,
  address?: string,
): Promise<{ address: string; tokenIds: string[]; txHash: string }> {
  const isTopUp = Boolean(address);
  const addr = (address ?? ethers.Wallet.createRandom().address).toLowerCase();

  const { txHash, tokenIds } = await reserveTokensToWallet({ to: addr, count: 1 });
  const idStrs = tokenIds.map((t) => String(t));

  let registered = 0;
  try {
    registered = await registerMintedTokens(addr, tokenIds, 'free');
  } catch (e) {
    logger.warn('bots.mint.register_threw', { address: addr, err: (e as Error).message });
  }
  const allRegistered = registered >= idStrs.length;

  // Always record the wallet + tokens durably, registered or not — an
  // on-chain pass with no record anywhere is unrecoverable.
  const doc: Record<string, unknown> = {
    isBot: true,
    address: addr,
    tokenIds: FieldValue.arrayUnion(...idStrs),
    passType: 'free',
    mintTxHash: txHash,
    lastMintAt: Date.now(),
  };
  if (!isTopUp) doc.createdAt = Date.now();
  if (!allRegistered) doc.unregisteredTokenIds = FieldValue.arrayUnion(...idStrs);
  await db.collection(BOT_COLLECTION).doc(addr).set(doc, { merge: true });

  try {
    await recordPassOrigins({ tokenIds: idStrs, origin: 'house_bot', ownerAtMint: addr, txHash, reason: 'house bot pool' });
  } catch (e) {
    logger.warn('bots.mint.origin_record_failed', { address: addr, err: (e as Error).message });
  }

  if (!allRegistered) {
    throw new Error(
      `pass ${idStrs.join(',')} minted on-chain to ${addr} but Go registration failed — ` +
        `the engine can't spend it. Recorded in botWallets.unregisteredTokenIds; ` +
        `fix registration (Go API up?) before minting more.`,
    );
  }

  return { address: addr, tokenIds: idStrs, txHash };
}
