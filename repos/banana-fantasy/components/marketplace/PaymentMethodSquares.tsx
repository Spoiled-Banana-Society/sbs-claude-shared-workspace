'use client';

import { useEffect } from 'react';

// Shared payment-method picker for the Buy / Make-Offer / Buy-Drafts modals.
// Two equal SQUARES: Card (Apple Pay / PayPal / Venmo brand badges — we don't
// name the processor) and the user's on-chain Balance / USDC.
//
// Web2 (embedded) users only see the Balance square if their balance actually
// covers the cost — otherwise it's a single, centered Card square (no point
// showing a balance they can't use). Web3 users always see both.

interface PaymentMethodSquaresProps {
  value: 'card' | 'usdc';
  onChange: (m: 'card' | 'usdc') => void;
  isEmbeddedWallet: boolean;
  /** USDC balance to show under the Balance square (optional). */
  usdcBalance?: number | null;
  /** What the action costs — gates the Balance square for web2 users. */
  requiredAmount?: number;
}

// Small payment-brand badges so the Card option shows the real logos people
// recognize, not a generic outline. Kept tiny so three fit inside the square.
function BrandLogos() {
  return (
    <div className="flex items-center gap-1">
      {/* Apple Pay */}
      <span className="inline-flex items-center gap-0.5 rounded bg-black px-1.5 py-[3px] leading-none">
        <svg viewBox="0 0 384 512" className="w-2 h-2 fill-white">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C61.5 141.3 0 184.8 0 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
        <span className="text-white text-[8px] font-semibold italic">Pay</span>
      </span>
      {/* PayPal */}
      <span className="inline-flex items-center rounded bg-white px-1.5 py-[3px] text-[8px] font-bold italic leading-none">
        <span style={{ color: '#253B80' }}>Pay</span><span style={{ color: '#179BD7' }}>Pal</span>
      </span>
      {/* Venmo */}
      <span className="rounded px-1.5 py-[3px] text-[8px] font-bold italic leading-none text-white" style={{ background: '#3D95CE' }}>
        venmo
      </span>
    </div>
  );
}

export function PaymentMethodSquares({ value, onChange, isEmbeddedWallet, usdcBalance, requiredAmount = 0 }: PaymentMethodSquaresProps) {
  const showBalance = !isEmbeddedWallet || (usdcBalance ?? 0) + 1e-9 >= requiredAmount;

  // If the Balance option vanished (web2 can't cover it), snap to Card.
  useEffect(() => {
    if (!showBalance && value === 'usdc') onChange('card');
  }, [showBalance, value, onChange]);

  const sq = (active: boolean) =>
    `flex flex-col items-center justify-center text-center gap-2 aspect-square rounded-xl border-2 p-3 transition-all ${
      active ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'
    }`;

  const cardSquare = (
    <button type="button" onClick={() => onChange('card')} className={sq(value === 'card' || !showBalance)}>
      <BrandLogos />
      <span className={`text-sm font-semibold ${value === 'card' || !showBalance ? 'text-text-primary' : 'text-text-secondary'}`}>Card</span>
    </button>
  );

  // Web2 without enough balance → single Card square, CENTERED (same size as one
  // of the two squares would be, not stretched full-width).
  if (!showBalance) {
    return (
      <div className="flex justify-center">
        <div className="w-[calc(50%-0.375rem)]">{cardSquare}</div>
      </div>
    );
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
