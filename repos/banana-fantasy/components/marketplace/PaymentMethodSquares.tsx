'use client';

import { useEffect } from 'react';

// Shared payment-method picker for the Buy / Make-Offer / Buy-Drafts modals.
// Two equal boxes: Card (real Apple Pay / Mastercard brand marks + the
// "Apple Pay · PayPal · Venmo" text — we don't name the processor) and the
// user's on-chain Balance / USDC.
//
// Web2 (embedded) users only see the Balance box if they ACTUALLY have a
// balance that covers the cost — otherwise it's a single, centered Card box
// (web2 wallets start at $0, so they normally just see Card). Web3 wallets
// always see both (they manage their own funds).

interface PaymentMethodSquaresProps {
  value: 'card' | 'usdc';
  onChange: (m: 'card' | 'usdc') => void;
  isEmbeddedWallet: boolean;
  /** USDC balance to show under the Balance box (optional). */
  usdcBalance?: number | null;
  /** What the action costs — gates the Balance box for web2 users. */
  requiredAmount?: number;
}

// Real card-brand marks (blue Apple Pay + red Mastercard), like the old MoonPay
// card box. Small so they sit neatly above the "Card" label.
function BrandLogos() {
  return (
    <div className="flex items-center gap-1.5">
      {/* Apple Pay — blue */}
      <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 leading-none" style={{ background: '#1A1F71' }}>
        <svg viewBox="0 0 384 512" className="w-2.5 h-2.5 fill-white">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C61.5 141.3 0 184.8 0 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
        <span className="text-white text-[9px] font-semibold italic">Pay</span>
      </span>
      {/* Mastercard — red */}
      <span className="inline-flex items-center rounded-md bg-white px-1.5 py-1 leading-none">
        <svg viewBox="0 0 36 22" className="h-3 w-auto">
          <circle cx="14" cy="11" r="9" fill="#EB001B" />
          <circle cx="22" cy="11" r="9" fill="#F79E1B" />
          <path d="M18 4.2a8.98 8.98 0 0 1 0 13.6 8.98 8.98 0 0 1 0-13.6z" fill="#FF5F00" />
        </svg>
      </span>
    </div>
  );
}

export function PaymentMethodSquares({ value, onChange, isEmbeddedWallet, usdcBalance, requiredAmount = 0 }: PaymentMethodSquaresProps) {
  const bal = usdcBalance ?? 0;
  // Web2 sees Balance only when they actually have funds that cover the cost.
  // (bal > 0 guard stops a $0 web2 wallet showing Balance on a $0 / empty
  // amount, e.g. an offer before a number is typed.)
  const showBalance = !isEmbeddedWallet || (bal > 0 && bal + 1e-9 >= requiredAmount);

  // If the Balance option vanished (web2 can't cover it), snap to Card.
  useEffect(() => {
    if (!showBalance && value === 'usdc') onChange('card');
  }, [showBalance, value, onChange]);

  // Compact landscape box (wider than tall) so it doesn't read as a tall column.
  const box = (active: boolean) =>
    `w-full flex flex-col items-center justify-center text-center gap-1.5 aspect-[3/2] rounded-xl border-2 p-3 transition-all ${
      active ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'
    }`;

  const cardBox = (
    <button type="button" onClick={() => onChange('card')} className={box(value === 'card' || !showBalance)}>
      <BrandLogos />
      <span className={`text-sm font-semibold leading-none ${value === 'card' || !showBalance ? 'text-text-primary' : 'text-text-secondary'}`}>Card</span>
      <span className="text-text-muted text-[10px] leading-none">Apple&nbsp;Pay · PayPal · Venmo</span>
    </button>
  );

  // Web2 without enough balance → single Card box, CENTERED at the same size one
  // of the two boxes would be (not stretched full-width).
  if (!showBalance) {
    return (
      <div className="flex justify-center">
        <div className="w-[calc(50%-0.375rem)]">{cardBox}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {cardBox}
      <button type="button" onClick={() => onChange('usdc')} className={box(value === 'usdc')}>
        <span className={`text-2xl font-bold leading-none ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>$</span>
        <span className={`text-sm font-semibold leading-none ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>{isEmbeddedWallet ? 'Balance' : 'USDC'}</span>
        <span className="text-text-muted text-[10px] leading-none">{usdcBalance != null ? `$${usdcBalance.toFixed(2)}` : ' '}</span>
      </button>
    </div>
  );
}
