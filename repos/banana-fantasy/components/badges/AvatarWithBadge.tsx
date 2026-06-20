'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { BadgeIcon } from './BadgeIcon';
import { BADGE_BY_ID } from '@/lib/badges/catalog';
import type { Ripeness } from '@/types';

interface AvatarWithBadgeProps {
  imageUrl?: string | null;
  alt?: string;
  size: number; // avatar diameter in pixels
  /** The user's currently equipped badge id, or null/undefined for none.
   *  When none, the user's dynamic "ripeness" banana is shown by default —
   *  everyone always has a banana unless they equip a different earned badge. */
  equippedBadge?: string | null;
  /** The user's current ripeness tier (color/label). Drives the default
   *  banana's fill + tooltip. Defaults to Unripe when omitted. */
  ripeness?: Ripeness | null;
  /** Set false to hide the corner badge entirely (e.g. very dense contexts
   *  where even the banana is too much). Defaults to true. */
  showBadge?: boolean;
  /** Set false to disable the hover tooltip on the corner badge. Default true. */
  showBadgeTooltip?: boolean;
  /** Optional CSS class overrides for the wrapper. */
  className?: string;
  /** Border-ring classes (e.g. "border-2 border-[#F3E216]"). Rendered as an
   *  overlay ON TOP of the badge so the ring is always a complete circle —
   *  pass the ring here instead of in `className` so the badge can't erase it. */
  ringClassName?: string;
  /** Default fallback avatar. */
  fallbackSrc?: string;
  /** Whether to use Next.js <Image>; default true. Pass false for surfaces
   *  where the image url is dynamic / unconfigured in next.config images.
   */
  useNextImage?: boolean;
  /** Corner badge size as a fraction of the avatar diameter. Default 0.44.
   *  Exposed so the size-comparison preview can render bigger options. */
  badgeScale?: number;
  /** Max corner badge size in px. Default 40. */
  badgeMax?: number;
  /** Container shape for the corner badge. Default 'circle'. */
  badgeShape?: 'circle' | 'squircle' | 'square' | 'square-soft' | 'shield' | 'hex';
  /** Separator ring width (px) around the corner badge. Default 0 (none). */
  badgeRingWidth?: number;
  /** Separator ring color. */
  badgeRingColor?: string;
  /** Soft rim-colored glow on the corner badge. */
  badgeGlow?: boolean;
  /** Where the badge sits: bottom-right corner (default) or top-center topper
   *  (crown-style, like some draft apps). */
  badgePosition?: 'br' | 'top';
  /** When a badge ring is present, the badge renders ON TOP of the avatar's
   *  border ring so the ring "notches" around it. Set the ring color
   *  (badgeRingColor) to the card/surface color for the punched-through look,
   *  or white/grey for a visible separator. */
}

/**
 * Wraps an avatar image with the user's equipped badge as a circular
 * overlay on the bottom-right rim. The badge size scales to roughly 54% of
 * the avatar diameter (clamped at 12px min, 44px max) so it stands out —
 * paired with the `plain`-mode content-first badge style (thin ring, the
 * logo/emoji nearly fills the disc) so you can read it at a glance.
 *
 * The badge is nudged onto the edge (poking slightly past the circle into the
 * empty box corner). The avatars sit centered inside much larger slots, so the
 * poke-out stays within any overflow-hidden parent and isn't clipped.
 *
 * Falls back to the banana avatar when there is no image URL *or* the
 * image fails to load — so a new user (whose backend pfp URL is often
 * empty or broken) always shows a clean banana, never a broken image.
 *
 * If equippedBadge is not in BADGE_BY_ID (renamed/removed catalog entry,
 * stale Firestore data, etc.), the badge silently doesn't render.
 */
export function AvatarWithBadge({
  imageUrl,
  alt = 'avatar',
  size,
  equippedBadge,
  ripeness,
  showBadge = true,
  showBadgeTooltip = true,
  className = '',
  ringClassName = '',
  fallbackSrc = '/banana-profile.png',
  useNextImage = true,
  badgeScale = 0.42,
  badgeMax = 40,
  // Locked design (2026-06-06): squircle badge box with a card-color cutout
  // ring so the badge reads as a clean emblem that notches the avatar ring.
  // Sites on a non-default surface pass their own badgeRingColor to match.
  badgeShape = 'squircle',
  badgeRingWidth = 2.5,
  badgeRingColor = '#1c1c1f',
  badgeGlow = false,
  badgePosition = 'br',
}: AvatarWithBadgeProps) {
  // Track image load failure so a broken/glitched pfp URL falls back to
  // the banana instead of rendering a broken image.
  const [loadFailed, setLoadFailed] = useState(false);
  // Reset the failure flag if the image URL changes (e.g. user updates pfp).
  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  const isFallback = !imageUrl || loadFailed;
  const src = isFallback ? fallbackSrc : imageUrl;
  const badgeSize = Math.min(badgeMax, Math.max(12, Math.round(size * badgeScale)));
  // Effective badge: the equipped one (if it's still a real catalog badge),
  // else the user's default banana = their highest unlocked ripeness tier
  // (derived from `ripeness`; Unripe for everyone else). A stale equipped id
  // from the old catalog falls back to the banana rather than rendering
  // nothing. So every avatar always shows a badge.
  // The default banana is EARNED, not given: it only shows once the user has
  // completed >= 1 paid draft (ripeness.count). A brand-new wallet (0 paid
  // drafts) shows NO badge unless it has equipped one (e.g. an NFL team badge).
  const earnedBananaId = ripeness?.label && (ripeness.count ?? 0) >= 1
    ? `ripeness-${ripeness.label.toLowerCase()}`
    : null;
  const equippedValid = equippedBadge && BADGE_BY_ID[equippedBadge] ? equippedBadge : null;
  const effectiveBadgeId = equippedValid || earnedBananaId;
  const badge = showBadge && effectiveBadgeId ? BADGE_BY_ID[effectiveBadgeId] : undefined;
  // Every avatar renders full-frame (object-cover fills the circle), so the
  // badge sits at the identical size + position on ALL of them — banana,
  // upload, anything. The default banana is itself a full-frame image now (a
  // banana on a filled background, like a photo), so it no longer needs a
  // code-side shrink — which is what used to make the badge float off it.
  const innerSize = size;
  const innerOffset = 0;

  // Badge sits on the bottom-right rim, poking slightly past the circle. The
  // avatars it appears in are centered inside much larger slots (e.g. the 48px
  // draft-room avatar sits in a 100–140px tile), so the small poke-out stays
  // well within any `overflow-hidden` parent and isn't clipped.
  return (
    <div
      className={`relative inline-block flex-shrink-0 rounded-full bg-cover bg-center ${className}`}
      // The banana sits as a background BEHIND the <img>. An opaque real pfp
      // covers it completely; a transparent/blank/slow-loading external pfp
      // (common for web2 Google/Gmail avatars on mobile — they can return a
      // 200 with empty content, or simply never finish loading, so onError
      // never fires) reveals the banana underneath instead of a blank circle.
      style={{ width: size, height: size, backgroundImage: isFallback ? undefined : `url(${fallbackSrc})` }}
    >
      {useNextImage ? (
        <Image
          src={src}
          alt={alt}
          width={innerSize}
          height={innerSize}
          className="rounded-full object-cover"
          style={{ width: innerSize, height: innerSize, position: 'absolute', top: innerOffset, left: innerOffset }}
          unoptimized
          onError={() => setLoadFailed(true)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={innerSize}
          height={innerSize}
          className="rounded-full object-cover"
          style={{ width: innerSize, height: innerSize, position: 'absolute', top: innerOffset, left: innerOffset }}
          onError={() => setLoadFailed(true)}
        />
      )}
      {(() => {
        const badgeEl = badge ? (
          <span
            key="badge"
            className="absolute pointer-events-auto"
            style={badgePosition === 'top'
              // display:flex + lineHeight:0 makes the badge a block-level flex
              // item so its vertical position is exact, not subject to the
              // inline-baseline gap (which drifted the badge 5–10px on small
              // avatars and made placement look inconsistent).
              ? { top: -Math.round(badgeSize * 0.42), left: '50%', transform: 'translateX(-50%)', width: badgeSize, height: badgeSize, display: 'flex', lineHeight: 0 }
              // Anchor the badge's INNER (top-left) corner at a fixed point on
              // the avatar's lower-right rim, so a BIGGER badge grows down +
              // right (away from the face) instead of creeping up over it. At
              // the default 0.42 scale these fractions reproduce the previous
              // right/bottom placement exactly.
              : { left: Math.round(size * 0.656), top: Math.round(size * 0.62), width: badgeSize, height: badgeSize, display: 'flex', lineHeight: 0 }}
          >
            <BadgeIcon
              badge={badge}
              size={badgeSize}
              unlocked
              plain
              shape={badgeShape}
              ringWidth={badgeRingWidth}
              ringColor={badgeRingColor}
              glow={badgeGlow}
              showTooltip={showBadgeTooltip}
            />
          </span>
        ) : null;
        const ringEl = ringClassName ? (
          <span key="ring" aria-hidden className={`absolute inset-0 rounded-full pointer-events-none ${ringClassName}`} />
        ) : null;
        // With a badge ring, the badge sits ON TOP of the border ring so the
        // ring notches around it. Without, the border ring is drawn last so
        // it stays a complete circle (legacy).
        return badgeRingWidth > 0 ? [ringEl, badgeEl] : [badgeEl, ringEl];
      })()}
    </div>
  );
}
