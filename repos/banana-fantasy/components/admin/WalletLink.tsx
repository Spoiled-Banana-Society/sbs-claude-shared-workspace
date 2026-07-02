'use client';

/**
 * Shared clickable-wallet primitive used everywhere wallets are displayed
 * in admin. One click → jumps to the User Lookup tab for that wallet.
 *
 * Pass `displayName` (banana name) to render "Banana #1234567 (0x438b…72e0)";
 * omit it for just the truncated hex. The whole rendered block is the link
 * target so it's a single click from anywhere a wallet appears.
 *
 * Mark `inline` when used inside flowing text (no block-level layout); the
 * default is a subtle underline + hover that fits in tables and lists.
 */

import Link from 'next/link';

interface Props {
  /** Full wallet address (40 hex with optional 0x prefix). */
  wallet: string;
  /** Optional pre-resolved banana / user-chosen display name. */
  displayName?: string | null;
  /** Force the full address visible. Default truncates middle. */
  full?: boolean;
  /** Suppress the underline / link styling. Useful when the parent row is itself clickable. */
  bare?: boolean;
  /** Show only the resolved name — no truncated hex beside it. The full
   *  wallet stays one click away (User Lookup) and in the hover title.
   *  Falls back to the truncated hex when no name resolved. */
  hideAddress?: boolean;
  /** Used inline (flow context). Default is inline-flex. */
  inline?: boolean;
  /** Extra Tailwind classes. */
  className?: string;
}

function shortHex(w: string): string {
  if (!w) return '';
  const hex = w.replace(/^0x/i, '');
  if (hex.length <= 10) return `0x${hex}`;
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export function WalletLink({
  wallet,
  displayName,
  full = false,
  bare = false,
  inline = false,
  hideAddress = false,
  className = '',
}: Props) {
  const wAddr = (wallet || '').trim().toLowerCase();
  if (!wAddr) return null;

  // Build the destination URL — `tab=user-lookup` lands on the dedicated
  // per-user view; `wallet=` populates the search so the page loads
  // immediately. The page itself preserves the user's other URL state.
  const href = `/admin?tab=user-lookup&wallet=${encodeURIComponent(wAddr)}`;

  const addrLabel = full ? wAddr : shortHex(wAddr);
  const trimmedName = displayName?.trim();

  const layout = inline ? 'inline' : 'inline-flex items-center gap-1';
  const style = bare
    ? 'text-current'
    : 'text-text-secondary decoration-banana/30 hover:text-banana hover:decoration-banana/70 underline decoration-dotted underline-offset-[3px] transition-colors';

  return (
    <Link
      href={href}
      title={trimmedName ? `${trimmedName} · ${wAddr}` : wAddr}
      className={`${layout} ${style} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {trimmedName ? (
        <>
          <span className="font-medium">{trimmedName}</span>
          {!hideAddress && (
            <span className="text-text-muted font-mono text-[11px]">{addrLabel}</span>
          )}
        </>
      ) : (
        <span className="font-mono text-[12px]">{addrLabel}</span>
      )}
    </Link>
  );
}
