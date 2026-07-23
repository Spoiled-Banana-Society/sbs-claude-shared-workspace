'use client';

import { useRef, useState } from 'react';
import type { Address } from 'viem';
import { useAuth } from '@/hooks/useAuth';
import { useMintDraftPass } from '@/hooks/useMintDraftPass';
import { getUsdcBalance } from '@/lib/contracts/bbb4';
import { DEPOSITS_ENABLED, ENTRY_PRICE_USD } from '@/lib/deposits';
import { clientLog } from '@/lib/clientLog';

/**
 * Deposit bankroll one-tap entry (Phase 1).
 *
 * When a user has ZERO passes but holds ≥ $25 USDC in their own wallet, the
 * entry CTAs offer "Enter draft · $25" instead of pushing them into the buy
 * modal. Under the hood this is the EXISTING purchase flow — a silent
 * permit+mint via useMintDraftPass (server relays + pays gas, pass registered
 * 'paid') — followed by the normal shared join. No new payment path exists.
 *
 * Ordering rule (do not reorder): passes are always consumed BEFORE money.
 * This hook is only consulted by CTAs after their `totalPasses <= 0` check,
 * so a user holding a pass can never be charged.
 */
export function useDepositEntry() {
  const { user, walletAddress, updateUser, refreshBalance } = useAuth();
  const { mint } = useMintDraftPass();
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  // Double-tap lock: a ref, not state, so the second tap of a double-tap is
  // rejected synchronously (state updates land a render too late).
  const inFlight = useRef(false);

  const passes = (user?.draftPasses || 0) + (user?.freeDrafts || 0);

  // Offer gate — uses the 30s-polled useAuth balance, which is fine for
  // SHOWING the option. The charge itself re-reads the balance live.
  //
  // `balanceEntryReady` is the same gate WITHOUT the zero-pass condition: it
  // says "this user could pay for a seat right now". It exists because the
  // pass chooser has to offer a paid seat to someone who holds only a FREE
  // pass (Richard 2026-07-22 — AceJohn had 1 free pass and $100 sitting there
  // with no way to buy in). It never charges on its own; the user taps a card
  // with the price on it, so pass-first ordering is preserved by default and
  // only overridden by an explicit choice.
  const balanceEntryReady =
    DEPOSITS_ENABLED && !!user && (user?.usdcBalance ?? 0) >= ENTRY_PRICE_USD;

  const depositEntryReady = balanceEntryReady && passes <= 0;

  /**
   * Buy exactly one pass from wallet balance. Resolves true on success (pass
   * minted + registered paid; caller proceeds to the shared join flow), false
   * on any failure (error surfaced via buyError; caller stays put).
   */
  const buyPassWithBalance = async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBuying(true);
    setBuyError(null);
    try {
      // Live pre-flight (mirrors BuyPassesModal): without it a short wallet
      // signs, the server transferFrom reverts, and the user sees a hang.
      if (walletAddress) {
        try {
          const bal = await getUsdcBalance(walletAddress as Address);
          if (bal < BigInt(ENTRY_PRICE_USD) * 1_000_000n) {
            setBuyError(
              `Balance too low — $${(Number(bal) / 1e6).toFixed(2)} of $${ENTRY_PRICE_USD}. Add funds and try again.`,
            );
            return false;
          }
        } catch {
          // RPC blip reading the balance — don't block; the server still guards.
        }
      }
      // Seat-first (Richard 2026-07-21): the instant route fronts the pass on
      // house money and responds the moment it's registered — the join below
      // starts seconds sooner, and the $25 collects in the background (house
      // eats + alerts on the rare failure).
      await mint(1, { paymentMethod: 'usdc', instantSeat: true });
      clientLog('payment', 'deposit_entry_mint_ok', { wallet: walletAddress });
      // The mint route already registered the pass with Go before responding,
      // so the join can start immediately. Bump the local count so the entry
      // flow's own optimistic decrement starts from 1, not a stale 0 — and
      // drop the shown balance by the $25 that just left the wallet, so the
      // chip moves INSTANTLY (Richard 7/21: it sat stale ~30s on mobile).
      // refreshBalance re-reads the true on-chain number right behind it.
      updateUser({
        draftPasses: (user?.draftPasses || 0) + 1,
        usdcBalance: Math.max(0, (user?.usdcBalance ?? 0) - ENTRY_PRICE_USD),
      });
      void refreshBalance();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Purchase failed';
      clientLog('payment', 'deposit_entry_mint_failed', { wallet: walletAddress, error: msg });
      setBuyError(msg);
      return false;
    } finally {
      inFlight.current = false;
      setBuying(false);
    }
  };

  const clearBuyError = () => setBuyError(null);

  return { depositEntryReady, balanceEntryReady, buying, buyError, clearBuyError, buyPassWithBalance };
}
