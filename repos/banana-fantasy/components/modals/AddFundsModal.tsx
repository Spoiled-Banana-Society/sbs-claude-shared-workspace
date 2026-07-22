'use client';

import React, { useRef, useState } from 'react';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import type { Address } from 'viem';
import { useAuth } from '@/hooks/useAuth';
import { BASE_SEPOLIA, getUsdcBalance, waitForUsdcArrival } from '@/lib/contracts/bbb4';
import { DEPOSIT_PRESETS_USD } from '@/lib/deposits';
import { clientLog } from '@/lib/clientLog';
import { logger } from '@/lib/logger';

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired after USDC has verifiably landed in the wallet. */
  onFunded?: (amountUsd: number) => void;
}

type Step = 'amount' | 'funding' | 'waiting' | 'done' | 'error';

/**
 * Deposit bankroll Add Funds (Phase 1) — funds the user's OWN wallet with
 * USDC via the existing Privy→MoonPay onramp, and deliberately STOPS there:
 * no mint, no charge. This is BuyPassesModal's funding leg minus its
 * wait-then-mint tail. Amounts are what the user RECEIVES (onramp fees ride
 * on top, exactly like today's card flow).
 *
 * ⚠️ Mount only while open — useFundWallet crashes if mounted at page level
 * (see CLAUDE.md troubleshooting). Callers must gate: {open && <AddFundsModal/>}.
 */
export function AddFundsModal({ isOpen, onClose, onFunded }: AddFundsModalProps) {
  const { walletAddress, refreshBalance } = useAuth();
  const { getAccessToken } = usePrivy();
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
  const [amount, setAmount] = useState<number>(DEPOSIT_PRESETS_USD[2]); // default $100
  const [customRaw, setCustomRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  if (!isOpen) return null;

  const effectiveAmount = customRaw ? Math.floor(Number(customRaw)) : amount;
  const amountValid = Number.isFinite(effectiveAmount) && effectiveAmount >= 10 && effectiveAmount <= 5000;

  const close = () => {
    cancelledRef.current = true;
    onClose();
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
        if (fundingMethodRef.current !== 'manual') {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={close} />

      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <button onClick={close} className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {(step === 'amount' || step === 'funding') && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-1">Add Funds</h2>
              <p className="text-white/50 text-sm">USDC lands in your wallet — enter drafts in one tap.</p>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {DEPOSIT_PRESETS_USD.map((p) => (
                <button
                  key={p}
                  onClick={() => { setAmount(p); setCustomRaw(''); }}
                  disabled={step === 'funding'}
                  className={`py-3 rounded-xl border-2 font-bold tabular-nums transition-all ${
                    !customRaw && amount === p
                      ? 'border-banana bg-banana/10 text-banana'
                      : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30'
                  }`}
                >
                  ${p}
                </button>
              ))}
            </div>

            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">$</span>
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={5000}
                placeholder="Custom amount"
                value={customRaw}
                disabled={step === 'funding'}
                onChange={(e) => setCustomRaw(e.target.value)}
                className="w-full pl-8 pr-4 py-3 rounded-xl bg-white/5 border-2 border-white/10 text-white placeholder-white/30 focus:border-banana/60 focus:outline-none tabular-nums"
              />
            </div>

            <button
              onClick={() => void startFunding()}
              disabled={!amountValid || step === 'funding'}
              className="w-full py-4 rounded-xl bg-banana text-black font-bold text-lg hover:brightness-110 transition-all disabled:opacity-50 disabled:hover:brightness-100"
            >
              {step === 'funding' ? 'Opening…' : amountValid ? `Add $${effectiveAmount}` : 'Add Funds'}
            </button>
            {!amountValid && customRaw && (
              <p className="text-center text-red-400 text-xs">Enter an amount between $10 and $5,000.</p>
            )}
            <p className="text-center text-white/30 text-xs">Card fees are added at checkout. Your money stays in your own wallet.</p>
          </div>
        )}

        {step === 'waiting' && (
          <div className="py-8 text-center space-y-4">
            <span className="inline-block w-8 h-8 border-2 border-banana border-t-transparent rounded-full animate-spin" />
            <h2 className="text-xl font-bold text-white">Waiting for your USDC…</h2>
            <p className="text-white/50 text-sm">Usually under a minute. You can close this — your balance updates automatically.</p>
            <button onClick={close} className="text-white/40 text-sm hover:text-white/60 transition-colors">Close</button>
          </div>
        )}

        {step === 'done' && (
          <div className="py-8 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <h2 className="text-xl font-bold text-white">Funds on the way</h2>
            <p className="text-white/50 text-sm">Your balance updates the moment the USDC lands.</p>
            <button
              onClick={close}
              className="px-8 py-3 rounded-xl bg-banana text-black font-bold hover:brightness-110 transition-all"
            >
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="py-8 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Something went wrong</h2>
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => { setError(null); setStep('amount'); }}
              className="px-8 py-3 rounded-xl bg-banana text-black font-bold hover:brightness-110 transition-all"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
