'use client';

import { useEffect } from 'react';

// Shared payment-method picker for the marketplace Buy + Make-Offer modals.
// Two equal SQUARES: Card (Apple Pay / PayPal / Venmo under the hood — we don't
// name the processor) and the user's on-chain Balance / USDC.
//
// Web2 (embedded) users only see the Balance square if their balance actually
// covers the cost — otherwise it's Card only (no point showing a balance they
// can't use). Web3 users always see both (they manage their own wallet).

interface PaymentMethodSquaresProps {
  value: 'card' | 'usdc';
  onChange: (m: 'card' | 'usdc') => void;
  isEmbeddedWallet: boolean;
  /** USDC balance to show under the Balance square (optional). */
  usdcBalance?: number | null;
  /** What the action costs — gates the Balance square for web2 users. */
  requiredAmount?: number;
}

export function PaymentMethodSquares({ value, onChange, isEmbeddedWallet, usdcBalance, requiredAmount = 0 }: PaymentMethodSquaresProps) {
  const showBalance = !isEmbeddedWallet || (usdcBalance ?? 0) + 1e-9 >= requiredAmount;

  // If the Balance option vanished (web2 can't cover it), snap to Card.
  useEffect(() => {
    if (!showBalance && value === 'usdc') onChange('card');
  }, [showBalance, value, onChange]);

  const sq = (active: boolean) =>
    `flex flex-col items-center justify-center text-center gap-1.5 aspect-square rounded-xl border-2 p-3 transition-all ${
      active ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'
    }`;

  const cardSquare = (
    <button type="button" onClick={() => onChange('card')} className={sq(value === 'card' || !showBalance)}>
      <svg className="w-7 h-7 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2.5" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
      <span className={`text-sm font-semibold ${value === 'card' || !showBalance ? 'text-text-primary' : 'text-text-secondary'}`}>Card</span>
      <span className="text-text-muted text-[10px] leading-tight">Apple&nbsp;Pay · PayPal · Venmo</span>
    </button>
  );

  // Web2 without enough balance → single Card square (left half, stays square).
  if (!showBalance) {
    return <div className="grid grid-cols-2 gap-3">{cardSquare}</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {cardSquare}
      <button type="button" onClick={() => onChange('usdc')} className={sq(value === 'usdc')}>
        <span className={`text-2xl font-bold leading-none ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>$</span>
        <span className={`text-sm font-semibold ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>{isEmbeddedWallet ? 'Balance' : 'USDC'}</span>
        <span className="text-text-muted text-[10px] leading-tight">{usdcBalance != null ? `$${usdcBalance.toFixed(2)}` : ' '}</span>
      </button>
    </div>
  );
}
