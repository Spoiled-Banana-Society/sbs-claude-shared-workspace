'use client';

import React from 'react';
import { ENTRY_PRICE_USD } from '@/lib/deposits';

interface DepositEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Speed picked → caller charges $25 (silent mint) then joins. */
  onEnter: (speed: 'fast' | 'slow') => void;
  /** Wallet USDC in dollars, for the balance line. */
  balanceUsd: number;
  /** True while the silent mint is in flight — locks the buttons. */
  busy: boolean;
  error: string | null;
  onAddFunds?: () => void;
}

/**
 * Deposit bankroll entry (Phase 1) — shown instead of BuyPassesModal when the
 * user has no passes but ≥ $25 USDC in their wallet. Same visual language as
 * EntryFlowModal's speed step; the price is ON the buttons so the spend is
 * always explicit ("Enter draft · $25", Richard 2026-07-21 — no separate
 * confirm sheet by design).
 */
export function DepositEntryModal({
  isOpen,
  onClose,
  onEnter,
  balanceUsd,
  busy,
  error,
  onAddFunds,
}: DepositEntryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => { if (!busy) onClose(); }}
      />

      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <button
          onClick={() => { if (!busy) onClose(); }}
          disabled={busy}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Choose Draft Speed</h2>
          <p className="text-white/50 text-sm">
            Balance: <span className="text-banana font-semibold tabular-nums">${balanceUsd.toFixed(2)}</span>
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => onEnter('fast')}
            disabled={busy}
            className="w-full group relative overflow-hidden rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-yellow-500/60 hover:bg-yellow-500/10 disabled:opacity-60"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Fast Draft · ${ENTRY_PRICE_USD}</h3>
                <p className="text-yellow-400 text-sm font-medium">30 seconds per pick</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-yellow-400 transition-colors">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>

          <button
            onClick={() => onEnter('slow')}
            disabled={busy}
            className="w-full group relative overflow-hidden rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-blue-500/60 hover:bg-blue-500/10 disabled:opacity-60"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Slow Draft · ${ENTRY_PRICE_USD}</h3>
                <p className="text-blue-400 text-sm font-medium">8 hours per pick</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-blue-400 transition-colors">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>
        </div>

        {busy && (
          <div className="mt-5 flex items-center justify-center gap-2 text-white/60 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-banana border-t-transparent rounded-full animate-spin" />
            Getting your pass…
          </div>
        )}

        {error && !busy && (
          <p className="mt-5 text-center text-red-400 text-sm">{error}</p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            className="text-white/40 text-sm hover:text-white/60 transition-colors"
          >
            Cancel
          </button>
          {onAddFunds && (
            <button
              onClick={() => { if (!busy) onAddFunds(); }}
              disabled={busy}
              className="text-banana/80 text-sm hover:text-banana transition-colors"
            >
              Add Funds
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
