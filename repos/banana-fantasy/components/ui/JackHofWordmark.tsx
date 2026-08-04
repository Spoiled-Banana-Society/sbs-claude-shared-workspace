/**
 * The JackHOF wordmark — "JACK" in Jackpot red, "HOF" in Hall-of-Fame gold.
 *
 * JackHOF is the only draft type that is TWO types at once (Jackpot + HOF on
 * one roster), and until now it rendered as a single flat orange label
 * (`#ffb35c`) that said neither. Splitting the word across both tier colors is
 * the whole identity: you read both prizes in one glance.
 *
 * ONE component so every surface agrees — team card, league name, lobby
 * header, the badge, the slot-machine result. Boris 2026-07-26.
 *
 * Colors are the tailwind tier tokens (`jackpot` #ef4444 / `hof` #D4AF37),
 * hardcoded here so the mark survives contexts without tailwind (the
 * /api/og/* ImageResponse renderers, which can't use utility classes).
 */

export const JACKPOT_RED = '#ef4444';
export const HOF_GOLD = '#D4AF37';

export interface JackHofWordmarkProps {
  /** Font size in px. Everything else scales off it. */
  size?: number;
  /** 'inline'  = JACKHOF on one line (league names, pills, card labels).
   *  'stacked' = JACK over HOF (badge disc at 36px+).
   *  'compact' = "JH" on one line, J red / H gold — for small discs. Stacked
   *    below ~36px puts each line at ~4px, which renders as an unreadable
   *    smudge; 20px IS BadgeIcon's default (avatar corner, inline-with-name),
   *    so the small case is the common one, not the edge case. */
  variant?: 'inline' | 'stacked' | 'compact';
  /** Dim + desaturate, for locked/inactive states. */
  muted?: boolean;
  className?: string;
}

export function JackHofWordmark({
  size = 16,
  variant = 'inline',
  muted = false,
  className = '',
}: JackHofWordmarkProps) {
  const jack = muted ? '#6b6b72' : JACKPOT_RED;
  const hof = muted ? '#8a8a92' : HOF_GOLD;
  const base: React.CSSProperties = {
    fontFamily: '-apple-system, system-ui, sans-serif',
    fontWeight: 900,
    letterSpacing: '.04em',
    lineHeight: 1,
    fontSize: size,
  };

  if (variant === 'compact') {
    return (
      <span className={className} style={{ ...base, display: 'inline-flex' }} aria-label="JackHOF">
        <span style={{ color: jack }}>J</span>
        <span style={{ color: hof }}>H</span>
      </span>
    );
  }

  if (variant === 'stacked') {
    return (
      <span
        className={className}
        style={{ ...base, display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}
        aria-label="JackHOF"
      >
        <span style={{ color: jack }}>JACK</span>
        {/* HOF sits slightly smaller so the two lines optically match width —
            "JACK" is 4 chars, "HOF" is 3. */}
        <span style={{ color: hof, fontSize: size * 1.18, marginTop: size * 0.1 }}>HOF</span>
      </span>
    );
  }

  return (
    <span className={className} style={{ ...base, display: 'inline-flex' }} aria-label="JackHOF">
      <span style={{ color: jack }}>JACK</span>
      <span style={{ color: hof }}>HOF</span>
    </span>
  );
}
