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
  const depositEntryReady =
    DEPOSITS_ENABLED &&
    !!user &&
    passes <= 0 &&
    (user?.usdcBalance ?? 0) >= ENTRY_PRICE_USD;

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
      await mint(1, { paymentMethod: 'usdc' });
      clientLog('payment', 'deposit_entry_mint_ok', { wallet: walletAddress });
      // The mint route already registered the pass with Go before responding,
      // so the join can start immediately. Bump the local count so the entry
      // flow's own optimistic decrement starts from 1, not a stale 0.
      updateUser({ draftPasses: (user?.draftPasses || 0) + 1 });
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

  return { depositEntryReady, buying, buyError, clearBuyError, buyPassWithBalance };
}
