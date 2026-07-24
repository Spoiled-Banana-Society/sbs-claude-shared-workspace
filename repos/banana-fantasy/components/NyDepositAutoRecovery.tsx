'use client';

import { useEffect, useRef } from 'react';
import type { Address } from 'viem';
import { useSignTypedData } from '@privy-io/react-auth';
import { useSafePrivy as usePrivy, usePrivyAvailable, useSafeWallets } from '@/providers/PrivyProvider';
import { useAuth } from '@/hooks/useAuth';
import { getOptimismUsdcBalance } from '@/lib/onchain/nyOptimismClient';
import { runNyDeposit } from '@/lib/nyBuyFlow';
import { clientLog } from '@/lib/clientLog';

// Shared with AddFundsModal's NY branch so the two can't sweep concurrently.
// (Both check + set it; worst case without it is a harmless failed second
// sweep, but the flag keeps the logs clean and the flows deterministic.)
declare global {
  interface Window { __nyDepositInFlight?: boolean }
}

// Only recover balances worth recovering — dust below this is left alone.
const MIN_RECOVER_USDC = 5_000_000n; // $5
const CHECK_INTERVAL_MS = 60_000;
const FIRST_CHECK_DELAY_MS = 10_000; // let app boot settle first

/**
 * Zero-tap recovery for NY web2 depositors. A NY card deposit delivers USDC on
 * the NY source chain (Optimism) and is normally swept + bridged to the user's
 * Base wallet by the Add Funds flow — but if that flow dies mid-job (sheet
 * closed, tab killed, crash), the money sits stranded in the user's own
 * source-chain wallet. This headless component makes that self-healing: while a
 * logged-in NY EMBEDDED-wallet user has the site open, it periodically checks
 * the source chain and, if a meaningful balance is sitting there, silently
 * finishes the sweep + bridge (embedded wallets sign with no UI) so the money
 * just appears in their balance. Web2 promise: the user deposits; everything
 * else is our job.
 *
 * Scope guards: embedded wallets only (external wallets would get a signature
 * popup out of nowhere — never do that); NY users only (server-decided);
 * renders nothing; one recovery at a time.
 *
 * ⚠️ Render-loop rule (CLAUDE.md): the effect's deps are stable scalars ONLY —
 * every Privy-derived callback is stashed in a ref, because their identities
 * churn per render and a fetch-bearing effect keyed on them self-DDoSes.
 */
export function NyDepositAutoRecovery() {
  // Raw Privy hooks crash when the provider failed to init (the app renders a
  // no-Privy fallback tree) — and unlike the modals this component is ALWAYS
  // mounted, so gate on availability before touching them.
  const available = usePrivyAvailable();
  return available ? <NyDepositAutoRecoveryInner /> : null;
}

function NyDepositAutoRecoveryInner() {
  const { walletAddress, refreshBalance } = useAuth();
  const { getAccessToken, user: privyUser } = usePrivy();
  const { signTypedData } = useSignTypedData();
  const { wallets } = useSafeWallets();

  const isEmbedded = privyUser?.wallet?.walletClientType === 'privy';

  // Ref-stash everything with unstable identity (render-loop rule).
  const depsRef = useRef({ getAccessToken, signTypedData, wallets, refreshBalance });
  depsRef.current = { getAccessToken, signTypedData, wallets, refreshBalance };

  useEffect(() => {
    if (!walletAddress || !isEmbedded) return;
    let disposed = false;
    let nyChecked = false;
    let isNy = false;

    const check = async () => {
      if (disposed || window.__nyDepositInFlight) return;
      const d = depsRef.current;
      try {
        // Resolve NY status once per mount — server-decided, false for
        // everyone outside NY, so non-NY users cost one fetch total.
        if (!nyChecked) {
          const token = await d.getAccessToken();
          const res = await fetch('/api/user/ny-status', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          nyChecked = true;
          isNy = !!res?.ny;
        }
        if (!isNy || disposed) return;

        const balance = await getOptimismUsdcBalance(walletAddress as Address).catch(() => 0n);
        if (balance < MIN_RECOVER_USDC || disposed || window.__nyDepositInFlight) return;

        window.__nyDepositInFlight = true;
        clientLog('payment', 'deposit_ny_auto_recovery_start', { wallet: walletAddress, opBalance: balance.toString() });
        try {
          await runNyDeposit({
            user: walletAddress as Address,
            depositCost: balance, // it's already there — sweep exactly what sits
            signTypedData: d.signTypedData as unknown as Parameters<typeof runNyDeposit>[0]['signTypedData'],
            wallets: d.wallets as unknown as Parameters<typeof runNyDeposit>[0]['wallets'],
            getAccessToken: d.getAccessToken,
          });
          clientLog('payment', 'deposit_ny_auto_recovery_done', { wallet: walletAddress, recovered: balance.toString() });
          void d.refreshBalance();
          // Report for the card-fee credit — server verifies the on-chain
          // arrival and is idempotent; amount = what actually landed.
          const token = await d.getAccessToken();
          if (token) {
            await fetch('/api/deposits/card-credit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ amountUsd: Math.round(Number(balance) / 1e6) }),
            }).catch(() => { /* non-fatal — credit recoverable from chain */ });
          }
        } finally {
          window.__nyDepositInFlight = false;
        }
      } catch (err) {
        clientLog('payment', 'deposit_ny_auto_recovery_failed', {
          wallet: walletAddress,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const first = setTimeout(() => { void check(); }, FIRST_CHECK_DELAY_MS);
    const interval = setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    return () => { disposed = true; clearTimeout(first); clearInterval(interval); };
  }, [walletAddress, isEmbedded]);

  return null;
}
