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

/**
 * Single-circle badge icon. Renders the badge's glyph centered in a
 * coloured ring. Locked variant is monochrome / 50% alpha. Hover tooltip
 * shows the badge label + description (or criteria when locked).
 */
export function BadgeIcon({
  badge,
  size = 20,
  unlocked = true,
  showTooltip = true,
  ringWidth,
}: BadgeIconProps) {
  const fontSize = Math.max(8, Math.round(size * 0.55));
  const ring = ringWidth ?? Math.max(1, Math.round(size * 0.1));
  const color = unlocked ? badge.color : '#4b5563'; // gray-600 when locked
  const glow = unlocked ? `0 0 6px ${badge.color}88` : 'none';

  const inner = (
    <span
      aria-label={badge.label}
      className="inline-flex items-center justify-center rounded-full select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}33`, // 20% alpha
        border: `${ring}px solid ${color}`,
        color,
        fontSize,
        lineHeight: 1,
        boxShadow: glow,
        opacity: unlocked ? 1 : 0.55,
        filter: unlocked ? undefined : 'grayscale(0.6)',
      }}
    >
      {badge.glyph}
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
