'use client';

import React, { useState, useEffect } from 'react';

interface EntryFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (passType: 'paid' | 'free', speed: 'fast' | 'slow') => void;
  paidPasses: number;
  freePasses: number;
  isSubmitting?: boolean;
  /** Optional — when provided (the pass-ticket flow), shows a small "Buy Drafts"
   *  button that switches into the buy/mint flow. Omitted on the regular Enter
   *  flows, so the button doesn't appear there. */
  onBuyMore?: () => void;
}

type Step = 'pass-type' | 'speed';

export function EntryFlowModal({
  isOpen,
  onClose,
  onComplete,
  paidPasses,
  freePasses,
  isSubmitting = false,
  onBuyMore,
}: EntryFlowModalProps) {
  const [step, setStep] = useState<Step>('pass-type');
  const [selectedPassType, setSelectedPassType] = useState<'paid' | 'free' | null>(null);

  const hasPaid = paidPasses > 0;
  const hasFree = freePasses > 0;
  const hasBoth = hasPaid && hasFree;

  // Reset state when modal opens/closes — always show pass type step
  // so user explicitly chooses paid vs free (avoids race with balance loading)
  useEffect(() => {
    if (!isOpen) {
      setStep('pass-type');
      setSelectedPassType(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePassSelect = (type: 'paid' | 'free') => {
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

  const handleBack = () => {
    if (step === 'speed' && hasBoth) {
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

        {/* Step indicators */}
        {hasBoth && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className={`w-2 h-2 rounded-full transition-all ${step === 'pass-type' ? 'bg-banana w-4' : 'bg-white/20'}`} />
            <div className={`w-2 h-2 rounded-full transition-all ${step === 'speed' ? 'bg-banana w-4' : 'bg-white/20'}`} />
          </div>
        )}

        {/* Step 1: Pass Type Selection */}
        {step === 'pass-type' && (
          <div className="space-y-5">
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <svg width="64" height="40" viewBox="0 0 88 56">
                  <defs>
                    <linearGradient id="goldGradientEntry" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#FBBF24"/>
                      <stop offset="100%" stopColor="#D97706"/>
                    </linearGradient>
                  </defs>
                  <rect x="0" y="0" width="88" height="56" rx="6" fill="url(#goldGradientEntry)"/>
                  <circle cx="0" cy="28" r="6" fill="#0a0a0a"/>
                  <circle cx="88" cy="28" r="6" fill="#0a0a0a"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white">Which Draft Pass?</h2>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => hasPaid && handlePassSelect('paid')}
                disabled={!hasPaid || isSubmitting}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  hasPaid
                    ? 'border-banana/30 bg-banana/5 hover:border-banana hover:bg-banana/10 hover:scale-[1.02] cursor-pointer'
                    : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className={`font-semibold ${hasPaid ? 'text-white' : 'text-white/40'}`}>Paid Draft Pass</p>
                  <p className={`text-3xl font-bold ${hasPaid ? 'text-banana' : 'text-white/40'}`}>
                    {paidPasses}
                  </p>
                </div>
              </button>

              <button
                onClick={() => hasFree && handlePassSelect('free')}
                disabled={!hasFree || isSubmitting}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  hasFree
                    ? 'border-green-500/30 bg-green-500/5 hover:border-green-500 hover:bg-green-500/10 hover:scale-[1.02] cursor-pointer'
                    : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className={`font-semibold ${hasFree ? 'text-white' : 'text-white/40'}`}>Free Draft Pass</p>
                  <p className={`text-3xl font-bold ${hasFree ? 'text-green-500' : 'text-white/40'}`}>
                    {freePasses}
                  </p>
                </div>
              </button>

              {/* Buy Drafts — only in the pass-ticket flow (onBuyMore). Same size
                  as the cards above, kept in this group so spacing is even. Distinct
                  neutral color so it reads as an action, not a pass type. */}
              {onBuyMore && (
                <button
                  onClick={() => { if (!isSubmitting) onBuyMore(); }}
                  disabled={isSubmitting}
                  className="w-full p-4 rounded-xl border-2 border-white/20 bg-white/[0.05] text-left hover:border-white/40 hover:bg-white/[0.08] hover:scale-[1.02] transition-all"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">Buy Drafts</p>
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
              {hasBoth && (
                <p className="text-white/50 text-sm">
                  Using <span className="text-banana font-semibold">{selectedPassType === 'paid' ? 'Paid Draft Pass' : 'Free Draft Pass'}</span>
                </p>
              )}
            </div>

            <div className="space-y-4">
              <button
                onClick={() => handleSpeedSelect('fast')}
                disabled={isSubmitting}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-5 text-left transition-all duration-300 hover:border-yellow-500/60 hover:bg-yellow-500/10"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Fast Draft</h3>
                      <p className="text-yellow-400 text-sm font-medium">30 seconds per pick</p>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-yellow-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>

              <button
                onClick={() => handleSpeedSelect('slow')}
                disabled={isSubmitting}
                className="w-full group relative overflow-hidden rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 text-left transition-all duration-300 hover:border-blue-500/60 hover:bg-blue-500/10"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Slow Draft</h3>
                      <p className="text-blue-400 text-sm font-medium">8 hours per pick</p>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-blue-400 transition-colors">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </button>
            </div>

            {/* Back / Footer */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={isSubmitting}
                className="text-white/40 text-sm hover:text-white/60 transition-colors"
              >
                {hasBoth ? '← Back' : 'Cancel'}
              </button>
              <p className="text-white/30 text-xs">1 pass will be used</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
