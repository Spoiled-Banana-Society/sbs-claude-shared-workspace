'use client';

import { useEffect } from 'react';

// Shared payment-method picker for the Buy / Make-Offer / Buy-Drafts / Sweep
// modals. Two cohesive boxes side by side:
//   • Card  — the 4 methods MoonPay accepts (Card / Apple Pay / PayPal / Venmo),
//             each as a minimal grey logo sitting ON TOP of its word.
//   • USDC  — the user's on-chain Balance, same box style (logo-on-top-of-word).
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

// All marks are monochrome and use `fill-current`, so they inherit the
// surrounding grey text color — minimal / Apple-style, never branded color.
const MARK = 'w-auto fill-current';

function CardMark() {
  return (
    <svg viewBox="0 0 24 16" className={`${MARK} h-[22px]`} aria-hidden="true">
      <rect x="0.9" y="0.9" width="22.2" height="14.2" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="0.9" y="3.6" width="22.2" height="2.7" />
      <rect x="3.2" y="10.4" width="6.2" height="2" rx="1" />
    </svg>
  );
}

function ApplePayMark() {
  // Plain Apple glyph (the word "Apple Pay" sits below it).
  return (
    <svg viewBox="0 0 384 512" className={`${MARK} h-[22px]`} aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C61.5 141.3 0 184.8 0 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function PayPalMark() {
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[22px]`} aria-hidden="true">
      <path d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z" />
    </svg>
  );
}

function VenmoMark() {
  // Venmo's mark is a simple bold "V".
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[22px]`} aria-hidden="true">
      <path d="M4.6 4.5 L12 19 L19.4 4.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsdcMark() {
  // Minimal grey dollar coin — bigger than the card marks since it's the whole
  // box's single icon, so it reads clearly and fills its box.
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[28px]`} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 5.4v13.2M14.9 8.2c-.55-.8-1.65-1.25-3-1.25-1.8 0-3.05.85-3.05 2.15 0 1.2.95 1.75 3.05 2.15 2.1.4 3.1.95 3.1 2.2 0 1.3-1.3 2.2-3.1 2.2-1.45 0-2.6-.55-3.15-1.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// One method = a minimal grey mark sitting on top of its word, all words the
// same size/font. Fixed-height mark row keeps every word baseline-aligned.
function Method({ mark, label }: { mark: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-end gap-1">
      <span className="flex h-5 items-center">{mark}</span>
      <span className="text-[11px] font-medium leading-none whitespace-nowrap">{label}</span>
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

  // Shared box shell — both boxes use the exact same shell so they read as a
  // cohesive pair. Grey text by default; selection shown by banana border/fill.
  const box = (active: boolean) =>
    `w-full flex flex-col items-center justify-center rounded-xl border-2 p-2.5 transition-all ${
      active ? 'border-banana bg-banana/10 text-text-primary' : 'border-white/25 hover:border-white/45 text-text-secondary'
    }`;

  const cardBox = (
    <button type="button" onClick={() => onChange('card')} className={box(value === 'card' || !showBalance)}>
      {/* 4 methods, each = grey logo on top of its word, all words one size. */}
      <div className="grid w-full grid-cols-2 gap-x-2 gap-y-2">
        <Method mark={<CardMark />} label="Card" />
        <Method mark={<ApplePayMark />} label="Apple Pay" />
        <Method mark={<PayPalMark />} label="PayPal" />
        <Method mark={<VenmoMark />} label="Venmo" />
      </div>
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

  // USDC / Balance box — its single icon + label are larger than the card
  // marks so it reads clearly and fills its half of the row.
  const usdcBox = (
    <button type="button" onClick={() => onChange('usdc')} className={box(value === 'usdc')}>
      <div className="flex h-full flex-col items-center justify-center gap-1">
        <span className="flex h-6 items-center">
          <UsdcMark />
        </span>
        <span className="text-base font-semibold leading-none">{isEmbeddedWallet ? 'Balance' : 'USDC'}</span>
        {!isEmbeddedWallet && <span className="text-text-secondary text-[11px] leading-none">on Base</span>}
      </div>
    </button>
  );

  // USDC/Balance on the LEFT, Card methods on the RIGHT (Boris 2026-06-20).
  return (
    <div className="grid grid-cols-2 items-stretch gap-3">
      {usdcBox}
      {cardBox}
    </div>
  );
}
