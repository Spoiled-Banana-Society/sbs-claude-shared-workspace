'use client';

import React, { useState, useEffect } from 'react';
import { ENTRY_PRICE_USD } from '@/lib/deposits';
import { SPIN_ON_PURCHASE_UI_ENABLED } from '@/lib/spinTypes';

interface EntryFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'balance' = buy a seat with wallet USDC right now, then join. */
  onComplete: (passType: 'paid' | 'free' | 'balance', speed: 'fast' | 'slow') => void;
  paidPasses: number;
  freePasses: number;
  isSubmitting?: boolean;
  /** Opens the buy/mint screen (quantity picker) without entering a draft. */
  onBuyMore?: () => void;
  /** Deposit bankroll is switched on, so a seat can be bought here for $25. */
  depositsEnabled?: boolean;
  /** Wallet USDC in dollars — decides pay-now vs Add Funds, and is shown on
   *  the speed step so the spend is visible right up to the charge. */
  balanceUsd?: number;
  /** Failure text from the balance purchase — keeps the modal open. */
  balanceError?: string | null;
  /** Balance is short of the entry price → send them to Add Funds instead. */
  onAddFunds?: () => void;
}

type Step = 'pass-type' | 'speed';

/**
 * The one chooser every entry point opens (Richard 2026-07-22). Three rows,
 * always the same three, whatever the user holds:
 *
 *   1. The paid seat — your Paid Draft Pass count if you have one, otherwise
 *      "Join Draft · $25" charged to your balance (or Add Funds if short).
 *   2. Your Free Draft Pass count.
 *   3. Buy Draft Passes — stock up without entering a draft, so the buy-4 /
 *      buy-10 promos are reachable.
 *
 * Passes still come before money by default: rows 1 and 2 spend a pass the
 * moment you hold one, and the $25 only ever appears on row 1 when there is no
 * paid pass to use.
 */
export function EntryFlowModal({
  isOpen,
  onClose,
  onComplete,
  paidPasses,
  freePasses,
  isSubmitting = false,
  onBuyMore,
  depositsEnabled = false,
  balanceUsd = 0,
  balanceError = null,
  onAddFunds,
}: EntryFlowModalProps) {
  const [step, setStep] = useState<Step>('pass-type');
  const [selectedPassType, setSelectedPassType] = useState<'paid' | 'free' | 'balance' | null>(null);

  const hasPaid = paidPasses > 0;
  const hasFree = freePasses > 0;
  // Row 1 turns into the $25 buy-in when there's no paid pass to spend. With
  // deposits off it stays the old greyed-out "Paid Draft Pass 0".
  const buyingSeat = !hasPaid && depositsEnabled;
  const canAffordSeat = balanceUsd >= ENTRY_PRICE_USD;
  const payingWithBalance = selectedPassType === 'balance';

  // Reset state when modal opens/closes — always show pass type step
  // so user explicitly chooses paid vs free (avoids race with balance loading)
  useEffect(() => {
    if (!isOpen) {
      setStep('pass-type');
      setSelectedPassType(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePassSelect = (type: 'paid' | 'free' | 'balance') => {
    if (isSubmitting) return;
    setSelectedPassType(type);
    setStep('speed');
  };

  const handleSpeedSelect = (speed: 'fast' | 'slow') => {
    if (isSubmitting) return;
    if (selectedPassType) {
      onComplete(selectedPassType, speed);
    }
  };

  /** Row 1. A paid pass is spent if there is one; otherwise this is the $25
   *  buy-in, which detours to Add Funds when the balance can't cover it. */
  const handleSeatSelect = () => {
    if (isSubmitting) return;
    if (hasPaid) { handlePassSelect('paid'); return; }
    if (!canAffordSeat) { onAddFunds?.(); return; }
    handlePassSelect('balance');
  };

  const handleBack = () => {
    if (step === 'speed') {
      setStep('pass-type');
      setSelectedPassType(null);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      />

      {/* Modal */}
      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Close button */}
        <button
          onClick={() => {
            if (!isSubmitting) onClose();
          }}
          disabled={isSubmitting}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {/* Step indicators — the chooser always precedes the speed step now. */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`w-2 h-2 rounded-full transition-all ${step === 'pass-type' ? 'bg-banana w-4' : 'bg-white/20'}`} />
          <div className={`w-2 h-2 rounded-full transition-all ${step === 'speed' ? 'bg-banana w-4' : 'bg-white/20'}`} />
        </div>

        {/* Step 1: Pass Type Selection */}
        {step === 'pass-type' && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">Which Draft Pass?</h2>
            </div>

            <div className="space-y-3">
              {/* Row 1 — the paid seat. Your Paid Draft Pass when you hold one,
                  the $25 buy-in (from balance, or Add Funds if short) when you
                  don't. Never a greyed "0" in the deposit world. */}
              <button
                onClick={handleSeatSelect}
                disabled={(!hasPaid && !buyingSeat) || isSubmitting}
                className={`w-full p-5 min-h-[5.5rem] flex flex-col justify-center rounded-xl border-2 text-left transition-all ${
                  hasPaid || buyingSeat
                    ? 'border-banana/30 bg-banana/5 hover:border-banana hover:bg-banana/10 hover:scale-[1.02] cursor-pointer'
                    : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div>
                    <p className={`font-semibold ${hasPaid || buyingSeat ? 'text-white' : 'text-white/40'}`}>
                      {buyingSeat ? 'Join Draft' : 'Paid Draft Pass'}
                    </p>
                    {buyingSeat && (
                      <p className="text-white/40 text-sm tabular-nums">
                        {canAffordSeat
                          ? `From your $${balanceUsd.toFixed(2)} balance`
                          : 'Add funds to enter'}
                      </p>
                    )}
                    {/* Only on the BUY variant — spending a pass you already own
                        isn't a purchase, so it doesn't come with a spin. */}
                    {buyingSeat && SPIN_ON_PURCHASE_UI_ENABLED && (
                      <p className="text-banana/70 text-xs mt-0.5">Includes a free bonus spin</p>
                    )}
                  </div>
                  <p className={`text-3xl font-bold ${hasPaid || buyingSeat ? 'text-banana' : 'text-white/40'}`}>
                    {buyingSeat ? `$${ENTRY_PRICE_USD}` : paidPasses}
                  </p>
                </div>
              </button>

              {/* Free Draft Pass — only shown when the user actually HAS one; a
                  greyed "0" card is noise (Boris 2026-07-22). */}
              {hasFree && (
                <button
                  onClick={() => handlePassSelect('free')}
                  disabled={isSubmitting}
                  className="w-full p-5 min-h-[5.5rem] flex flex-col justify-center rounded-xl border-2 border-green-500/30 bg-green-500/5 hover:border-green-500 hover:bg-green-500/10 hover:scale-[1.02] cursor-pointer text-left transition-all disabled:opacity-60"
                >
                  <div className="flex w-full items-center justify-between">
                    <p className="font-semibold text-white">Free Draft Pass</p>
                    <p className="text-3xl font-bold text-green-500">{freePasses}</p>
                  </div>
                </button>
              )}

              {/* Row 3 — stock up without drafting. This is the only route to
                  buying several at once, which the buy-4 / buy-10 promos need,
                  so it shows for everyone. Neutral colour: it's an action, not
                  a pass you hold. */}
              {onBuyMore && (
                <button
                  onClick={() => { if (!isSubmitting) onBuyMore(); }}
                  disabled={isSubmitting}
                  className="w-full p-5 min-h-[5.5rem] flex flex-col justify-center rounded-xl border-2 border-white/20 bg-white/[0.05] text-left hover:border-white/40 hover:bg-white/[0.08] hover:scale-[1.02] transition-all disabled:opacity-60"
                >
                  <div className="flex w-full items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">Buy Draft Passes</p>
                      <p className="text-white/40 text-sm">Buy without entering a draft</p>
                    </div>
                    <span className="text-3xl font-bold text-white/70 leading-none">+</span>
                  </div>
                </button>
              )}
            </div>

            <button
              onClick={() => {
                if (!isSubmitting) onClose();
              }}
              disabled={isSubmitting}
              className="w-full text-center text-white/40 text-sm hover:text-white/60 transition-colors py-2"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Step 2: Speed Selection */}
        {step === 'speed' && (
          <div>
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Choose Draft Speed</h2>
              {payingWithBalance ? (
                <p className="text-white/50 text-sm">
                  Balance: <span className="text-banana font-semibold tabular-nums">${balanceUsd.toFixed(2)}</span>
                </p>
              ) : (
                <p className="text-white/50 text-sm">
                  Using <span className="text-banana font-semibold">{selectedPassType === 'paid' ? 'Paid Draft Pass' : 'Free Draft Pass'}</span>
                </p>
              )}
            </div>

            <div className="space-y-4">
              <button
                onClick={() => handleSpeedSelect('fast')}
                disabled={isSubmitting}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-yellow-500/60 hover:bg-yellow-500/10"
              >
                <div className="flex w-full items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">Fast Draft{payingWithBalance ? ` · $${ENTRY_PRICE_USD}` : ''}</h3>
                    <p className="text-yellow-400 text-sm font-medium">30 seconds per pick</p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-yellow-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>

              <button
                onClick={() => handleSpeedSelect('slow')}
                disabled={isSubmitting}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-blue-500/60 hover:bg-blue-500/10"
              >
                <div className="flex w-full items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">Slow Draft{payingWithBalance ? ` · $${ENTRY_PRICE_USD}` : ''}</h3>
                    <p className="text-blue-400 text-sm font-medium">8 hours per pick</p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-blue-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            </div>

            {/* Buying with balance keeps the modal open through the charge, so
                it owns the spinner and any failure text (the pass paths hand off
                to the "Joining lobby" overlay instead). */}
            {payingWithBalance && isSubmitting && (
              <div className="mt-5 flex items-center justify-center gap-2 text-white/60 text-sm">
                <span className="inline-block w-4 h-4 border-2 border-banana border-t-transparent rounded-full animate-spin" />
                Joining draft…
              </div>
            )}

            {balanceError && !isSubmitting && (
              <p className="mt-5 text-center text-red-400 text-sm">{balanceError}</p>
            )}

            {/* Back / Footer */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={isSubmitting}
                className="text-white/40 text-sm hover:text-white/60 transition-colors"
              >
                ← Back
              </button>
              <p className="text-white/30 text-xs">
                {payingWithBalance ? `$${ENTRY_PRICE_USD} will be charged` : '1 pass will be used'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
