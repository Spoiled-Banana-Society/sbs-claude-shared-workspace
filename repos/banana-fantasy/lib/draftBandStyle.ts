/**
 * Single source of truth for the draft-room type banner look (the top band +
 * the PRO/HOF/JACKPOT word). Used by the filling, reveal, and drafting bands so
 * they can never drift apart. Treatment picked by Boris 2026-06-13 from the
 * /banner-lab comparison: P1 (HOF) + P2 (Jackpot) — vivid but with a
 * metallic/glass finish so it reads premium, not flat-cheap. Pro stays a black
 * band with the clean flat purple word (no glow). No word glows on any type.
 */
import type { DraftType } from './draftRoomConstants';

// Vivid gold with a polished metallic multi-stop + a glass sheen overlay.
const HOF_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.18) 100%), ' +
  'linear-gradient(180deg,#F4DC7A 0%,#DCB845 40%,#BE9430 72%,#A37C26 100%)';

// Vivid red with a glossy radial spotlight + a glass sheen overlay.
const JP_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.20) 100%), ' +
  'radial-gradient(130% 130% at 50% -12%, #E63A40 0%, #C71F29 46%, #8E141C 100%)';

// Glassy edge + soft drop for depth on the colored (HOF/JP) bands.
const GLASS_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.5), 0 10px 34px rgba(0,0,0,0.5)';
const FLAT_SHADOW = 'inset 0 -1px 0 rgba(0,0,0,0.45)';

export function draftBandBackground(type: DraftType | null): string {
  if (type === 'hof') return HOF_BAND;
  if (type === 'jackpot') return JP_BAND;
  return '#000';
}

export function draftBandShadow(type: DraftType | null): string {
  return type === 'hof' || type === 'jackpot' ? GLASS_SHADOW : FLAT_SHADOW;
}

/** Color of the PRO / HOF / JACKPOT word in the banner. */
export function draftWordColor(type: DraftType | null): string {
  if (type === 'hof') return '#241900';   // espresso, reads on bright gold
  if (type === 'jackpot') return '#ffffff';
  return '#a855f7';                         // pro purple (clean default)
}

/** Subtle legibility shadow on the word — NOT a glow. Pro stays clean. */
export function draftWordShadow(type: DraftType | null): string | undefined {
  if (type === 'hof') return '0 1px 0 rgba(255,255,255,0.35)';   // crisp top highlight
  if (type === 'jackpot') return '0 1px 4px rgba(0,0,0,0.5)';    // soft drop for white on red
  return undefined;
}

/** Color of the status line ("1 turn until your pick!") on each band. */
export function draftStatusColor(type: DraftType | null): string {
  if (type === 'hof') return '#231900';
  return '#fff';
}

/**
 * Color of the FOUNDER word — the SAME color as the band's type word so e.g.
 * "JACKPOT FOUNDER" reads as one unit (Boris 2026-06-16): white on JACKPOT,
 * dark on HOF, purple on PRO.
 */
export function founderWordColor(type: DraftType | null): string {
  return draftWordColor(type);
}
