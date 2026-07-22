'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import type { Address } from 'viem';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/components/ui/Modal';
import { CardMethodsGraphic } from '@/components/marketplace/PaymentMethodSquares';
import { BASE_SEPOLIA, getUsdcBalance, waitForUsdcArrival } from '@/lib/contracts/bbb4';
import { DEPOSIT_PRESETS_USD } from '@/lib/deposits';
import { feeForDepositUsd, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { clientLog } from '@/lib/clientLog';
import { logger } from '@/lib/logger';

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired after the money has verifiably landed in the account. */
  onFunded?: (amountUsd: number) => void;
}

type Step = 'amount' | 'funding' | 'waiting' | 'done' | 'error';

/**
 * Deposit bankroll Add Funds (Phase 1) — funds the user's OWN wallet via the
 * existing Privy→MoonPay onramp, and deliberately STOPS there: no mint, no
 * charge. This is BuyPassesModal's funding leg minus its wait-then-mint tail,
 * styled on the same shared Modal + preset-grid the buy flow uses (Richard
 * 2026-07-21). Amounts are what the user RECEIVES (card fees ride on top,
 * exactly like today's card flow). Copy never says "USDC" — it's just money.
 *
 * Rendered through a PORTAL to <body>: the sticky header has backdrop-blur,
 * which turns it into the containing block for position:fixed descendants —
 * mounting this inside the header pinned the sheet off the top of the screen.
 *
 * ⚠️ Mount only while open — useFundWallet crashes if mounted at page level
 * (see CLAUDE.md troubleshooting). Callers must gate: {open && <AddFundsModal/>}.
 */
export function AddFundsModal({ isOpen, onClose, onFunded }: AddFundsModalProps) {
  const { walletAddress, refreshBalance, user } = useAuth();
  const { getAccessToken, user: privyUser } = usePrivy();
  // Card-fee credit is WEB2 ONLY — embedded-wallet deposits ride the MoonPay
  // card onramp; external (web3) wallets fund themselves, no card fee to
  // credit. The server enforces this too; skipping here just avoids a 403.
  const isEmbeddedWallet = privyUser?.wallet?.walletClientType === 'privy';
  // Positively-known external wallet (metamask, coinbase_wallet, …) → the
  // MetaMask-buy branch. Unknown/undefined stays on the web2 card flow —
  // wrong-branching a web2 user into MetaMask would dead-end them, and the
  // server independently gates the fee credit either way.
  const isExternalWallet = !!privyUser?.wallet?.walletClientType && !isEmbeddedWallet;
  // What funding method the user actually picked inside the Privy widget —
  // only card deposits earn the card-fee credit ('manual' = external wallet
  // transfer, no card fee). null/undefined = widget didn't say; assume card
  // (it's the default flow we open into).
  const fundingMethodRef = useRef<string | null>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: ({ balance, fundingMethod }) => {
      fundingMethodRef.current = fundingMethod ?? null;
      logger.debug('[AddFunds] Fund wallet exited:', { balance: balance?.toString(), fundingMethod });
    },
  });

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<number>(DEPOSIT_PRESETS_USD[0]); // default $25 (Richard 2026-07-21)
  const [customRaw, setCustomRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  if (!isOpen || typeof document === 'undefined') return null;

  const effectiveAmount = customRaw ? Math.floor(Number(customRaw)) : amount;
  const amountValid = Number.isFinite(effectiveAmount) && effectiveAmount >= 10 && effectiveAmount <= 5000;

  const close = () => {
    cancelledRef.current = true;
    onClose();
  };

  // Web3 (external wallet): MetaMask's OWN buy surface. We can't open the
  // extension's internal Buy screen (no dapp API exists for it), but
  // portfolio.metamask.io is MetaMask's official buy page — user connects the
  // same wallet there and the purchase lands at their address. We watch the
  // balance so the modal still confirms arrival. Amount is chosen on their
  // side, so any ≥ $5 arrival counts as funded.
  const startWeb3Funding = async () => {
    if (!walletAddress || step === 'waiting') return;
    cancelledRef.current = false;
    setError(null);
    clientLog('payment', 'deposit_funding_opened', { wallet: walletAddress, via: 'metamask_portfolio' });
    let target = 5_000_000n;
    try {
      target += await getUsdcBalance(walletAddress as Address);
    } catch { /* fall back to waiting on just the increment */ }
    // chainId + address preselect USD Coin on Base — verified 2026-07-21 in
    // the live portfolio UI (`token=`/`tokenAddress=` variants do NOT work;
    // bare /buy defaults to ETH mainnet, the one thing users must not buy).
    window.open(
      'https://portfolio.metamask.io/buy?chainId=8453&address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '_blank',
      'noopener',
    );
    setStep('waiting');
    const funded = await waitForUsdcArrival(walletAddress as Address, target, {
      isCancelled: () => cancelledRef.current,
    });
    if (cancelledRef.current) return;
    if (funded) {
      clientLog('payment', 'deposit_funding_arrived', { wallet: walletAddress, via: 'metamask_portfolio' });
      void refreshBalance();
      onFunded?.(0);
    }
    setStep('done');
  };

  const startFunding = async () => {
    if (!walletAddress || !amountValid || step === 'funding' || step === 'waiting') return;
    cancelledRef.current = false;
    setError(null);
    setStep('funding');
    clientLog('payment', 'deposit_funding_opened', { wallet: walletAddress, amountUsd: effectiveAmount });
    try {
      // Balance floor to wait for = current balance + deposit (waitForUsdcArrival
      // checks total balance, not deltas). Read before the popup opens.
      let target = BigInt(effectiveAmount) * 1_000_000n;
      try {
        target += await getUsdcBalance(walletAddress as Address);
      } catch {
        // If the pre-read fails, waiting on just the deposit amount still
        // resolves for the common (low prior balance) case.
      }

      const result = await fundWallet({
        address: walletAddress,
        options: {
          chain: BASE_SEPOLIA,
          amount: String(effectiveAmount),
          asset: 'USDC',
          defaultFundingMethod: 'card',
          card: { preferredProvider: 'moonpay' },
        },
      });
      if ((result as { status?: string } | undefined)?.status === 'cancelled' || cancelledRef.current) {
        setStep('amount');
        return;
      }

      setStep('waiting');
      const funded = await waitForUsdcArrival(walletAddress as Address, target, {
        isCancelled: () => cancelledRef.current,
      });
      if (cancelledRef.current) return;
      if (funded) {
        clientLog('payment', 'deposit_funding_arrived', { wallet: walletAddress, amountUsd: effectiveAmount });
        void refreshBalance();
        // Card-fee credit accrues at DEPOSIT time (Richard 2026-07-21). Fire
        // and forget — the server verifies the transfer on-chain and is
        // idempotent, and the reward toast arrives via the user event stream.
        // Skip when the user picked an external-transfer method (no card fee).
        if (isEmbeddedWallet && fundingMethodRef.current !== 'manual') {
          void (async () => {
            try {
              const token = await getAccessToken();
              if (!token) return;
              await fetch('/api/deposits/card-credit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ amountUsd: effectiveAmount }),
              });
            } catch {
              // Non-fatal — the deposit itself succeeded; credit is recoverable
              // from the on-chain record if this report is ever missed.
            }
          })();
        }
        onFunded?.(effectiveAmount);
        setStep('done');
      } else {
        // Timeout ≠ failure — card settlements can straggle. The balance poll
        // in useAuth will pick it up; tell the user that, don't alarm them.
        setStep('done');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Funding failed';
      clientLog('payment', 'deposit_funding_failed', { wallet: walletAddress, error: msg });
      setError(msg);
      setStep('error');
    }
  };

  return createPortal(
    <Modal isOpen={isOpen} onClose={close} title="Add Funds" size="sm">
      {/* Web3 (external wallet): amount + methods live on MetaMask's side, so
          no preset grid — one clean handoff to their buy page. */}
      {(step === 'amount' || step === 'funding') && isExternalWallet && (
        <div className="space-y-4">
          <p className="text-text-muted text-sm text-center -mt-2">
            Buy USDC on Base with MetaMask — it lands in your connected wallet, then you can enter drafts in one tap.
          </p>
          <button
            onClick={() => void startWeb3Funding()}
            className="w-full py-3.5 rounded-xl bg-banana text-black font-bold text-[15px] hover:brightness-110 transition-all"
          >
            Open MetaMask Buy
          </button>
          <p className="text-center text-text-muted text-xs">
            Already have USDC elsewhere? Send it to your connected wallet and you&apos;re set.
          </p>
        </div>
      )}

      {(step === 'amount' || step === 'funding') && !isExternalWallet && (
        <div className="space-y-4">
          <p className="text-text-muted text-sm text-center -mt-2">
            Money goes to your balance — enter drafts in one tap.
          </p>

          {/* Amount Selection — same grid language as the buy modal */}
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Amount</h3>
            <div className="grid grid-cols-4 gap-2">
              {DEPOSIT_PRESETS_USD.map((p) => (
                <button
                  key={p}
                  onClick={() => { setAmount(p); setCustomRaw(''); }}
                  disabled={step === 'funding'}
                  className={`py-2.5 rounded-xl font-bold text-[15px] tabular-nums transition-colors ${
                    !customRaw && amount === p
                      ? 'bg-banana text-bg-primary'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                  }`}
                >
                  ${p}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-3">
              <span className="text-text-muted text-sm">Custom:</span>
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={5000}
                  value={customRaw}
                  disabled={step === 'funding'}
                  onChange={(e) => setCustomRaw(e.target.value)}
                  className="w-full bg-bg-tertiary border border-bg-elevated rounded-xl pl-8 pr-4 py-2 text-center text-text-primary font-medium focus:outline-none focus:border-banana transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* How you can pay — same 4-method strip as the buy modal's card
              box. Static: card is the only path here, nothing to pick. */}
          <div className="rounded-xl border-2 border-white/25 p-2.5">
            <CardMethodsGraphic />
          </div>

          {/* Card-fee credit banner — mirrors BuyPassesModal's (⚠️ keep the two
              in sync). Credit accrues at DEPOSIT time now, so first-time card
              users see the fronted free pass HERE; returning users see live $
              progress toward the next one. Web2 only — that's who the credit
              applies to. */}
          {isEmbeddedWallet && (() => {
            const threshold = FREE_DRAFT_CREDIT_CENTS; // $25 in cents
            const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
            if (user?.cardFeeFrontGranted !== true) {
              return (
                <div className="bg-banana/[0.08] border border-banana/20 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-banana" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
                      <rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3.5 13h17M12 9v11M12 9S10.5 5 8 5a2 2 0 0 0 0 4zM12 9s1.5-4 4-4a2 2 0 0 1 0 4z" />
                    </svg>
                    <p className="text-white/85 text-[12px] font-semibold">
                      Your first card payment includes a FREE Paid Draft Pass — the card fee&apos;s on us
                    </p>
                  </div>
                  <p className="text-white/40 text-[10px] mt-1.5">
                    After that, every $25 in card fees earns you another free Paid Draft Pass — automatically.
                  </p>
                </div>
              );
            }
            const current = Math.min(threshold, user?.cardFeeCreditCents || 0);
            const feeThisDeposit = amountValid ? feeForDepositUsd(effectiveAmount) : 0;
            const earnsNow = current + feeThisDeposit >= threshold;
            const curPct = Math.min(100, (current / threshold) * 100);
            return (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <p className="text-white/75 text-[12px] font-semibold">
                    {earnsNow
                      ? 'This one earns you a FREE Paid Draft Pass 🎉'
                      : 'Card fees add up to free Paid Draft Passes'}
                  </p>
                  <span className="text-white/45 text-[11px] tabular-nums">{usd(current)} / {usd(threshold)}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-banana" style={{ width: `${curPct}%` }} />
                </div>
              </div>
            );
          })()}

          <button
            onClick={() => void startFunding()}
            disabled={!amountValid || step === 'funding'}
            className="w-full py-3.5 rounded-xl bg-banana text-black font-bold text-[15px] hover:brightness-110 transition-all disabled:opacity-50 disabled:hover:brightness-100"
          >
            {step === 'funding' ? 'Opening…' : amountValid ? `Add $${effectiveAmount}` : 'Add Funds'}
          </button>
          {!amountValid && customRaw && (
            <p className="text-center text-red-400 text-xs">Enter an amount between $10 and $5,000.</p>
          )}
          <p className="text-center text-text-muted text-xs">Card fees are added at checkout.</p>
        </div>
      )}

      {step === 'waiting' && (
        <div className="py-6 text-center space-y-4">
          <span className="inline-block w-8 h-8 border-2 border-banana border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-bold text-text-primary">Adding to your balance…</h2>
          <p className="text-text-muted text-sm">Usually under a minute. You can close this — your balance updates automatically.</p>
          <button onClick={close} className="text-text-muted text-sm hover:text-text-secondary transition-colors">Close</button>
        </div>
      )}

      {step === 'done' && (
        <div className="py-6 text-center space-y-4">
          <div className="text-4xl">✅</div>
          <h2 className="text-xl font-bold text-text-primary">Funds on the way</h2>
          <p className="text-text-muted text-sm">Your balance updates the moment it lands.</p>
          <button
            onClick={close}
            className="px-8 py-3 rounded-xl bg-banana text-black font-bold hover:brightness-110 transition-all"
          >
            Done
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="py-6 text-center space-y-4">
          <h2 className="text-xl font-bold text-text-primary">Something went wrong</h2>
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setStep('amount'); }}
            className="px-8 py-3 rounded-xl bg-banana text-black font-bold hover:brightness-110 transition-all"
          >
            Try again
          </button>
        </div>
      )}
    </Modal>,
    document.body,
  );
}
