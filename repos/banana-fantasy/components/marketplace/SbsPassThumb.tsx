/**
 * Branded BBB IV pass thumbnail used as a fallback when the SBS backend
 * hasn't generated a per-card image yet (in-progress drafts, unused
 * passes). Replaces the bare-banana placeholder so every marketplace
 * row looks intentional rather than half-loaded.
 *
 * Pass `label` (e.g. "BBB #218" or "#287") to print on the card; omit
 * for the plain "Banana Best Ball IV" branding.
 */
'use client';

import { useId } from 'react';

interface Props {
  label?: string;
  size?: number;
  className?: string;
}

export function SbsPassThumb({ label, size = 56, className = '' }: Props) {
  const id = useId();
  const w = size;
  const h = Math.round(size * 1.4);
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 56 80"
      className={className}
      aria-label={label ? `BBB IV pass — ${label}` : 'BBB IV pass'}
    >
      <defs>
        <linearGradient id={`sbsPassGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="56" height="80" rx="8" fill={`url(#sbsPassGrad-${id})`} />
      <circle cx="0" cy="40" r="5" fill="#1a1a2e" />
      <circle cx="56" cy="40" r="5" fill="#1a1a2e" />
      <text
        x="28"
        y={label ? 33 : 44}
        textAnchor="middle"
        fill="#1C1C1E"
        fontSize="7"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        BBB IV
      </text>
      {label && (
        <text
          x="28"
          y="50"
          textAnchor="middle"
          fill="#1C1C1E"
          fontSize="9"
          fontWeight="800"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
