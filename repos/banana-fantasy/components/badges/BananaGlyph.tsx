import React from 'react';
import { BANANA_VIEWBOX, BANANA_TRANSFORM, BANANA_PATH } from '@/lib/badges/bananaPath';

/**
 * The vectorized SBS banana, filled with a single solid color. Used as the
 * center content of the Ripeness badge — the fill color is the user's
 * ripeness-tier color (green → spoiled-brown). Fills its container; size it
 * via the wrapping element.
 */
export function BananaGlyph({ color }: { color: string }) {
  return (
    <svg
      viewBox={BANANA_VIEWBOX}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <g transform={BANANA_TRANSFORM} fill={color} stroke="none">
        <path d={BANANA_PATH} />
      </g>
    </svg>
  );
}
