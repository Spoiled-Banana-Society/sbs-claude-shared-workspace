'use client';

// Shared payment-method picker for the marketplace Buy + Make-Offer modals.
// Two equal SQUARES: Card (Apple Pay / PayPal / Venmo under the hood — we don't
// name the processor) and the user's on-chain Balance / USDC.

interface PaymentMethodSquaresProps {
  value: 'card' | 'usdc';
  onChange: (m: 'card' | 'usdc') => void;
  isEmbeddedWallet: boolean;
  /** USDC balance to show under the Balance square (optional). */
  usdcBalance?: number | null;
}

export function PaymentMethodSquares({ value, onChange, isEmbeddedWallet, usdcBalance }: PaymentMethodSquaresProps) {
  const sq = (active: boolean) =>
    `flex flex-col items-center justify-center text-center gap-1.5 aspect-square rounded-xl border-2 p-3 transition-all ${
      active ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'
    }`;
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => onChange('card')} className={sq(value === 'card')}>
        <svg className="w-7 h-7 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2.5" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
        <span className={`text-sm font-semibold ${value === 'card' ? 'text-text-primary' : 'text-text-secondary'}`}>Card</span>
        <span className="text-text-muted text-[10px] leading-tight">Apple&nbsp;Pay · PayPal · Venmo</span>
      </button>
      <button type="button" onClick={() => onChange('usdc')} className={sq(value === 'usdc')}>
        <span className={`text-2xl font-bold leading-none ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>$</span>
        <span className={`text-sm font-semibold ${value === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>{isEmbeddedWallet ? 'Balance' : 'USDC'}</span>
        <span className="text-text-muted text-[10px] leading-tight">{usdcBalance != null ? `$${usdcBalance.toFixed(2)}` : ' '}</span>
      </button>
    </div>
  );
}
