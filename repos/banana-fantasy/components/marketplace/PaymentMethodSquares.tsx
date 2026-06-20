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
    <svg viewBox="0 0 24 16" className={`${MARK} h-[18px]`} aria-hidden="true">
      <rect x="0.9" y="0.9" width="22.2" height="14.2" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="0.9" y="3.6" width="22.2" height="2.7" />
      <rect x="3.2" y="10.4" width="6.2" height="2" rx="1" />
    </svg>
  );
}

function ApplePayMark() {
  // Plain Apple glyph (the word "Apple Pay" sits below it).
  return (
    <svg viewBox="0 0 384 512" className={`${MARK} h-[19px]`} aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C61.5 141.3 0 184.8 0 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function PayPalMark() {
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[18px]`} aria-hidden="true">
      <path d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z" />
    </svg>
  );
}

function VenmoMark() {
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[18px]`} aria-hidden="true">
      <path d="M21.772 13.119c-.267 0-.381-.251-.38-.655 0-.533.121-1.575.712-1.575.267 0 .357.243.357.598 0 .533-.13 1.632-.689 1.632Zm.502-3.377c-1.677 0-2.405 1.285-2.405 2.658 0 1.042.421 1.874 1.693 1.874 1.717 0 2.438-1.406 2.438-2.763 0-1.025-.462-1.769-1.726-1.769Zm-3.833 0c-.558 0-.964.17-1.393.477-.154-.275-.462-.477-.932-.477-.542 0-.947.219-1.247.437l-.04-.364H13.54l-.688 4.354h1.506l.479-3.053c.129-.065.323-.154.518-.154.145 0 .267.049.267.267 0 .056-.016.145-.024.218l-.429 2.722h1.498l.478-3.053c.138-.073.324-.154.51-.154.146 0 .268.049.268.267 0 .056-.017.145-.025.218l-.429 2.722h1.499l.461-2.908c.025-.153.049-.388.049-.549 0-.582-.267-.97-1.037-.97Zm-6.871 0c-.575 0-.98.219-1.287.421l-.017-.348H8.962l-.689 4.354H9.78l.478-3.053c.13-.065.324-.154.518-.154.147 0 .268.049.268.242 0 .081-.024.227-.032.299l-.422 2.666h1.499l.462-2.908c.024-.153.049-.388.049-.549 0-.582-.268-.97-1.03-.97Zm-5.631 1.834c.041-.485.413-.824.697-.824.162 0 .299.097.299.291 0 .404-.713.533-.996.533Zm.843-1.834c-1.604 0-2.382 1.39-2.382 2.698 0 1.01.478 1.817 1.814 1.817.527 0 1.07-.113 1.418-.282l.186-1.26c-.494.25-.874.347-1.271.347-.365 0-.64-.194-.64-.687.826-.008 2.252-.347 2.252-1.453 0-.687-.494-1.18-1.377-1.18Zm-4.239.267c.089.186.146.412.146.743 0 .606-.429 1.494-.777 2.06l-.373-2.989L0 9.969l.705 4.2h1.757c.77-1.01 1.718-2.448 1.718-3.554 0-.347-.073-.622-.235-.889l-1.402.283Z" />
    </svg>
  );
}

function UsdcMark() {
  // Minimal grey dollar coin to mirror the card-method marks.
  return (
    <svg viewBox="0 0 24 24" className={`${MARK} h-[19px]`} aria-hidden="true">
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
    `w-full flex flex-col items-center justify-center rounded-xl border-2 p-3 transition-all ${
      active ? 'border-banana bg-banana/10 text-text-primary' : 'border-bg-tertiary hover:border-bg-elevated text-text-secondary'
    }`;

  const cardBox = (
    <button type="button" onClick={() => onChange('card')} className={box(value === 'card' || !showBalance)}>
      {/* 4 methods, each = grey logo on top of its word, all words one size. */}
      <div className="grid w-full grid-cols-2 gap-x-2 gap-y-3">
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

  return (
    <div className="grid grid-cols-2 items-stretch gap-3">
      {cardBox}
      <button type="button" onClick={() => onChange('usdc')} className={box(value === 'usdc')}>
        {/* Mirrors a Method: grey mark on top of its word, same word size. */}
        <div className="flex h-full flex-col items-center justify-center gap-1">
          <span className="flex h-5 items-center">
            <UsdcMark />
          </span>
          <span className="text-[11px] font-medium leading-none">{isEmbeddedWallet ? 'Balance' : 'USDC'}</span>
          <span className="text-text-muted text-[10px] leading-none">{usdcBalance != null ? `$${usdcBalance.toFixed(2)}` : ' '}</span>
        </div>
      </button>
    </div>
  );
}
