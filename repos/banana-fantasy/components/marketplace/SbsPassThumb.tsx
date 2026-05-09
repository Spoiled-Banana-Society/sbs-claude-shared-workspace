/**
 * Branded BBB IV pass thumbnail used as a fallback when the SBS backend
 * hasn't generated a per-card image yet (in-progress drafts, unused
 * passes). Replaces the bare-banana placeholder so every marketplace
 * row looks intentional rather than half-loaded.
 *
 * Compact mode (size ≤ 120): just shows "BBB IV" + label.
 * Large mode (size > 120) with `roster`: renders a card-art-style list
 *   of roster slots, mimicking the real Go-API-generated team card.
 * Large mode without roster: shows "Drafting in progress" instead.
 */
'use client';

import { useId } from 'react';

interface Props {
  label?: string;
  size?: number;
  roster?: string[];
  className?: string;
}

export function SbsPassThumb({ label, size = 56, roster, className = '' }: Props) {
  const id = useId();
  const w = size;
  const h = Math.round(size * 1.4);
  const isLarge = size > 120;

  // Compact thumbnail rendering — used in Sell tab tiles. Mimics the
  // real Go-API-generated card art: yellow rounded rectangle, header,
  // 15 thin roster slot lines (filled if `roster` provided, blank
  // placeholder dashes otherwise). Same silhouette as actual cards so
  // tiles look uniform side-by-side.
  if (!isLarge) {
    const slotCount = 15;
    const slots = Array.from({ length: slotCount }, (_, i) => roster?.[i] ?? '');
    const slotStartY = 20;
    const slotStep = 3.4;
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 56 80"
        className={className}
        aria-label={label ? `BBB IV team card — ${label}` : 'BBB IV team card'}
      >
        <defs>
          <linearGradient id={`sbsPassGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="56" height="80" rx="6" fill={`url(#sbsPassGrad-${id})`} />
        <text
          x="28"
          y="9"
          textAnchor="middle"
          fill="#1C1C1E"
          fontSize="3"
          fontWeight="700"
          letterSpacing="0.3"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          BANANA BEST BALL
        </text>
        {label && (
          <text
            x="28"
            y="15"
            textAnchor="middle"
            fill="#1C1C1E"
            fontSize="3.2"
            fontWeight="800"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {label}
          </text>
        )}
        {slots.map((slot, i) => (
          <text
            key={i}
            x="28"
            y={slotStartY + i * slotStep}
            textAnchor="middle"
            fill={slot ? '#1C1C1E' : '#1C1C1E'}
            fillOpacity={slot ? 1 : 0.35}
            fontSize="2.6"
            fontWeight={slot ? 600 : 400}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {slot || '———'}
          </text>
        ))}
        <text
          x="28"
          y="76"
          textAnchor="middle"
          fill="#1C1C1E"
          fillOpacity="0.55"
          fontSize="2"
          letterSpacing="0.4"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          SPOILED BANANA SOCIETY
        </text>
      </svg>
    );
  }

  // Large card rendering — full team card mock used on the detail page
  // when SBS backend has the team but hasn't generated card art yet.
  // Layout mirrors the printed-card aesthetic: header band → roster
  // slots stacked vertically → footer.
  const hasRoster = Array.isArray(roster) && roster.length > 0;
  const slots = hasRoster ? roster.slice(0, 15) : [];
  const slotStartY = 90;
  const slotLineHeight = 22;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 320 448"
      className={className}
      aria-label={label ? `BBB IV team card — ${label}` : 'BBB IV team card'}
    >
      <defs>
        <linearGradient id={`sbsCardGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="320" height="448" rx="22" fill={`url(#sbsCardGrad-${id})`} />
      <text x="160" y="40" textAnchor="middle" fill="#1C1C1E" fontSize="14" fontWeight="700" letterSpacing="2" fontFamily="system-ui">
        BANANA BEST BALL
      </text>
      {label && (
        <text x="160" y="68" textAnchor="middle" fill="#1C1C1E" fontSize="22" fontWeight="800" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {label}
        </text>
      )}
      <line x1="40" y1="80" x2="280" y2="80" stroke="#1C1C1E" strokeOpacity="0.25" strokeWidth="1.5" />
      {hasRoster ? (
        slots.map((slot, i) => (
          <text
            key={i}
            x="160"
            y={slotStartY + i * slotLineHeight}
            textAnchor="middle"
            fill="#1C1C1E"
            fontSize="13"
            fontWeight="600"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {slot}
          </text>
        ))
      ) : (
        <>
          <text x="160" y="220" textAnchor="middle" fill="#1C1C1E" fontSize="16" fontWeight="700" fontFamily="system-ui">
            Drafting in progress
          </text>
          <text x="160" y="244" textAnchor="middle" fill="#1C1C1E" fillOpacity="0.6" fontSize="12" fontFamily="system-ui">
            Card art will appear once the draft completes
          </text>
        </>
      )}
      <text x="160" y="430" textAnchor="middle" fill="#1C1C1E" fillOpacity="0.55" fontSize="9" letterSpacing="1.5" fontFamily="system-ui">
        SPOILED BANANA SOCIETY
      </text>
    </svg>
  );
}
