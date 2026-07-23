'use client';

import React, { useEffect, useState } from 'react';
import { ENTRY_PRICE_USD } from '@/lib/deposits';

interface BuyPassesBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Charge qty × $25 to the wallet balance. */
  onBuy: (qty: number) => void;
  balanceUsd: number;
  busy: boolean;
  error: string | null;
  onAddFunds?: () => void;
}

const PRESETS = [1, 2, 5, 10, 20];
/** Server ceiling on both payment paths — clamp here so nobody types 500. */
const MAX_QTY = 100;

/**
 * Buy passes from balance, nothing else (Richard 2026-07-22: "should literally
 * just show your balance and ask you how many passes you want to buy"). The
 * full BuyPassesModal — payment-method squares, card/Apple Pay/Venmo, referral
 * box — is deliberately NOT reused here: with a funded balance the only
 * question left is how many. Topping up is Add Funds' job.
 */
export function BuyPassesBalanceModal({
  isOpen,
  onClose,
  onBuy,
  balanceUsd,
  busy,
  error,
  onAddFunds,
}: BuyPassesBalanceModalProps) {
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!isOpen) setQty(1);
  }, [isOpen]);

  if (!isOpen) return null;

  const total = qty * ENTRY_PRICE_USD;
  const affordable = qty >= 1 && total <= balanceUsd;
  const shortBy = Math.max(0, total - balanceUsd);

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

        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-2">Buy Draft Passes</h2>
          <p className="text-white/50 text-sm">
            Balance: <span className="text-banana font-semibold tabular-nums">${balanceUsd.toFixed(2)}</span>
          </p>
        </div>

        <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">How many?</h3>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map((n) => (
            <button
              key={n}
              onClick={() => { if (!busy) setQty(n); }}
              disabled={busy}
              className={`py-2.5 rounded-xl font-bold text-[15px] transition-colors ${
                qty === n
                  ? 'bg-banana text-black'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-3">
          <span className="text-white/40 text-sm">Custom:</span>
          <input
            type="number"
            min="1"
            max={MAX_QTY}
            value={qty || ''}
            disabled={busy}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') setQty(0);
              else setQty(Math.min(MAX_QTY, Math.max(1, parseInt(val) || 1)));
            }}
            onBlur={() => { if (qty < 1) setQty(1); }}
            className="flex-1 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-2 text-center text-white font-medium focus:outline-none focus:border-banana transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <div className="mt-5 rounded-xl bg-white/[0.04] border border-white/10 p-4 space-y-2">
          <div className="flex w-full items-center justify-between text-sm">
            <span className="text-white/60">
              {qty} draft pass{qty !== 1 ? 'es' : ''} × ${ENTRY_PRICE_USD}
            </span>
            <span className="text-white font-semibold tabular-nums">${total}</span>
          </div>
          <div className="flex w-full items-center justify-between text-sm">
            <span className="text-white/60">{affordable ? 'Balance after' : 'Short by'}</span>
            <span className={`font-semibold tabular-nums ${affordable ? 'text-white/80' : 'text-red-400'}`}>
              ${affordable ? (balanceUsd - total).toFixed(2) : shortBy.toFixed(2)}
            </span>
          </div>
        </div>

        <button
          onClick={() => {
            if (busy) return;
            if (affordable) onBuy(qty);
            else onAddFunds?.();
          }}
          disabled={busy || qty < 1}
          className={`w-full mt-5 py-3.5 rounded-xl font-bold text-base transition-all ${
            busy || qty < 1
              ? 'bg-banana/50 text-black/50 cursor-not-allowed'
              : 'bg-banana text-black hover:brightness-110 hover:scale-[1.01]'
          }`}
        >
          {busy
            ? 'Buying…'
            : affordable
              ? `Buy ${qty} Draft Pass${qty !== 1 ? 'es' : ''} · $${total}`
              : 'Add Funds'}
        </button>

        {error && !busy && (
          <p className="mt-4 text-center text-red-400 text-sm">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            className="text-white/40 text-sm hover:text-white/60 transition-colors"
          >
            Cancel
          </button>
          {onAddFunds && affordable && (
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
