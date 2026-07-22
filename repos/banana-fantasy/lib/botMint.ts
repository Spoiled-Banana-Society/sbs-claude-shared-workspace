import { ethers } from 'ethers';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { seedBotUserIdentity } from '@/lib/db';
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

  // Record the wallet + tokens durably BEFORE attempting registration, with
  // the tokens pessimistically flagged as unregistered. If the process dies
  // anywhere in the retry window below, the orphan is already on record and
  // the fill route's breaker still refuses further mints — an on-chain pass
  // with no record anywhere is unrecoverable (token 2638, 7/19). The flag is
  // cleared on success.
  const doc: Record<string, unknown> = {
    isBot: true,
    address: addr,
    tokenIds: FieldValue.arrayUnion(...idStrs),
    unregisteredTokenIds: FieldValue.arrayUnion(...idStrs),
    passType: 'free',
    mintTxHash: txHash,
    lastMintAt: Date.now(),
  };
  if (!isTopUp) doc.createdAt = Date.now();
  await db.collection(BOT_COLLECTION).doc(addr).set(doc, { merge: true });

  // Every bot is a directory citizen: seed its v2_users presence + sequential
  // Banana#### handle so All Users / drafts / search all show the same real
  // name (Boris 2026-07-21). Idempotent, best-effort — never blocks a mint.
  await seedBotUserIdentity(addr).catch((e) =>
    logger.warn('bots.mint.identity_seed_failed', { address: addr, err: (e as Error).message }));

  try {
    await recordPassOrigins({ tokenIds: idStrs, origin: 'house_bot', ownerAtMint: addr, txHash, reason: 'house bot pool' });
  } catch (e) {
    logger.warn('bots.mint.origin_record_failed', { address: addr, err: (e as Error).message });
  }

  // Go's Firestore write path has shown transient per-instance DeadlineExceeded
  // wedges lasting seconds-to-minutes (2026-07-21, three times). Retry
  // registration over ~1 min before leaving the orphan flag standing — the
  // breaker stays as last resort, and the routes have maxDuration 300 so the
  // budget is safe.
  const RETRY_DELAYS_MS = [0, 5_000, 10_000, 20_000, 30_000];
  let registered = 0;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      registered = await registerMintedTokens(addr, tokenIds, 'free');
    } catch (e) {
      logger.warn('bots.mint.register_threw', { address: addr, err: (e as Error).message });
    }
    if (registered >= idStrs.length) break;
    logger.warn('bots.mint.register_retrying', { address: addr, tokens: idStrs, nextDelayMs: delay });
  }
  const allRegistered = registered >= idStrs.length;

  if (!allRegistered) {
    throw new Error(
      `pass ${idStrs.join(',')} minted on-chain to ${addr} but Go registration failed — ` +
        `the engine can't spend it. Recorded in botWallets.unregisteredTokenIds; ` +
        `fix registration (Go API up?) before minting more.`,
    );
  }

  // Registration confirmed — lift the pessimistic orphan flag. If THIS write
  // fails the pass is healthy but the breaker will hold future mints; say so
  // explicitly (heal = just delete the flag, registration is already done).
  try {
    await db.collection(BOT_COLLECTION).doc(addr).update({
      unregisteredTokenIds: FieldValue.arrayRemove(...idStrs),
    });
  } catch (e) {
    throw new Error(
      `pass ${idStrs.join(',')} registered fine but clearing botWallets.unregisteredTokenIds failed ` +
        `(${(e as Error).message}) — pass is USABLE; just remove the flag to unblock minting.`,
    );
  }

  return { address: addr, tokenIds: idStrs, txHash };
}
