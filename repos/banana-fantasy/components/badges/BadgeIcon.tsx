'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Badge } from '@/types';

interface BadgeIconProps {
  badge: Badge;
  size?: number; // pixel diameter — default 20
  unlocked?: boolean; // greys it out + shows criteria tooltip when false
  showTooltip?: boolean; // wrap in <Tooltip>; default true
  ringWidth?: number; // outer ring width in px; default scales with size
}

const LOCKED_GREY = '#4b5563';

/**
 * Renders a single badge icon. Each badge in the catalog has its own
 * combination of color, glyph, gradient, ring style, and glow so no two
 * look identical.
 *
 * Visual treatments:
 *  - `gradient: true` → background fills with a color → accentColor
 *    diagonal gradient (high-tier feel).
 *  - `ringStyle: 'double'` → adds an outer ring with a small gap.
 *  - `ringStyle: 'rainbow'` → animated rainbow ring (BBB Champion).
 *  - `glow: 'soft'` → static drop-shadow.
 *  - `glow: 'pulse'` → animated scale + glow (legendary tier).
 *  - `ringColor` overrides the border color (HOF podium uses gold rings).
 *
 * Locked variant strips all flair and renders a flat grey disc.
 */
export function BadgeIcon({
  badge,
  size = 20,
  unlocked = true,
  showTooltip = true,
  ringWidth,
}: BadgeIconProps) {
  // Multi-character glyphs (e.g. NFL team 3-letter codes) need a smaller
  // font so they fit inside the disc; single-char glyphs keep the larger
  // emoji-friendly sizing.
  const glyphLen = [...badge.glyph].length;
  const fontScale = glyphLen >= 3 ? 0.32 : glyphLen === 2 ? 0.42 : 0.55;
  const fontSize = Math.max(7, Math.round(size * fontScale));
  const iconSize = Math.round(size * 0.78);

  // When badge.iconUrl is set, render the image inside the disc;
  // otherwise fall back to the text/emoji glyph.
  const glyphContent = badge.iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={badge.iconUrl}
      alt=""
      width={iconSize}
      height={iconSize}
      style={{ objectFit: 'contain', display: 'block' }}
      draggable={false}
    />
  ) : (
    badge.glyph
  );
  const ring = ringWidth ?? Math.max(1, Math.round(size * 0.1));
  const color = unlocked ? badge.color : LOCKED_GREY;
  const accent = unlocked ? (badge.accentColor || badge.color) : LOCKED_GREY;
  const ringColor = unlocked ? (badge.ringColor || color) : LOCKED_GREY;

  const background = unlocked && badge.gradient
    ? `linear-gradient(135deg, ${color} 0%, ${accent} 100%)`
    : `${color}33`; // 20% alpha

  const baseGlow = unlocked
    ? badge.glow === 'soft'
      ? `0 0 8px ${color}88`
      : badge.glow === 'pulse'
        ? undefined // handled via .badge-pulse animation
        : `0 0 4px ${color}44`
    : 'none';

  const wrapperClass = unlocked && badge.glow === 'pulse'
    ? 'inline-flex items-center justify-center select-none badge-pulse'
    : 'inline-flex items-center justify-center select-none';

  // Brushed-metal sweep used by the 'medal' ring style. Built from the
  // badge's own color (highlight) + accent (shadow) so silver reads silver
  // and bronze reads bronze; the moving background-position gives the ring a
  // living polished-metal sheen.
  const medalSweep = `linear-gradient(90deg, ${color}, ${accent}, ${color}, ${accent}, ${color})`;

  const inner = badge.ringStyle === 'rainbow' && unlocked ? (
    // Rainbow-ring tier: outer rotating gradient ring with the badge
    // disc inside.
    <span
      className="relative inline-flex items-center justify-center rounded-full select-none"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full badge-rainbow-ring"
        style={{ padding: ring }}
        aria-hidden
      >
        <span
          className={wrapperClass}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '9999px',
            background: badge.gradient
              ? `linear-gradient(135deg, ${color}, ${accent})`
              : `${color}E6`,
            color: '#fff',
            fontSize,
            lineHeight: 1,
            boxShadow: baseGlow,
          }}
        >
          {glyphContent}
        </span>
      </span>
    </span>
  ) : badge.ringStyle === 'medal' && unlocked ? (
    // Medal tier: a brushed-metal sheen ring (same mechanism as the rainbow
    // ring) wrapping the medallion disc. Reserved for the BBB podium — a
    // top-3-overall finish, so it should read far richer than a flat disc.
    <span
      className="relative inline-flex items-center justify-center rounded-full select-none"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full badge-medal-ring"
        style={{ padding: ring, background: medalSweep, boxShadow: baseGlow }}
        aria-hidden
      >
        <span
          className={wrapperClass}
          aria-label={badge.label}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '9999px',
            background,
            color: '#fff',
            fontSize,
            lineHeight: 1,
          }}
        >
          {glyphContent}
        </span>
      </span>
    </span>
  ) : badge.ringStyle === 'double' && unlocked ? (
    // Double-ring tier: outer ring + inset inner badge with a small gap
    // so it looks like a medallion.
    <span
      className="relative inline-flex items-center justify-center rounded-full select-none"
      style={{
        width: size,
        height: size,
        border: `${ring}px solid ${ringColor}`,
        boxShadow: baseGlow,
      }}
    >
      <span
        className={wrapperClass}
        aria-label={badge.label}
        style={{
          width: size - ring * 3,
          height: size - ring * 3,
          borderRadius: '9999px',
          background,
          border: `${Math.max(1, Math.round(ring * 0.6))}px solid ${ringColor}`,
          color: unlocked ? '#fff' : LOCKED_GREY,
          fontSize,
          lineHeight: 1,
          opacity: unlocked ? 1 : 0.55,
          filter: unlocked ? undefined : 'grayscale(0.6)',
        }}
      >
        {glyphContent}
      </span>
    </span>
  ) : (
    // Standard single-ring badge.
    <span
      aria-label={badge.label}
      className={wrapperClass}
      style={{
        width: size,
        height: size,
        borderRadius: '9999px',
        background,
        border: `${ring}px solid ${ringColor}`,
        color: unlocked ? '#fff' : LOCKED_GREY,
        fontSize,
        lineHeight: 1,
        boxShadow: baseGlow,
        opacity: unlocked ? 1 : 0.55,
        filter: unlocked ? undefined : 'grayscale(0.6)',
      }}
    >
      {glyphContent}
    </span>
  );

  if (!showTooltip) return inner;

  return (
    <Tooltip
      position="top"
      content={
        <div className="text-xs leading-tight">
          <div className="font-bold">{badge.label}</div>
          <div className="text-text-secondary">
            {unlocked ? badge.description : badge.criteria}
          </div>
        </div>
      }
    >
      {inner}
    </Tooltip>
  );
}
