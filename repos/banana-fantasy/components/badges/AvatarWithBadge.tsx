'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { BadgeIcon } from './BadgeIcon';
import { BADGE_BY_ID } from '@/lib/badges/catalog';
import { useIsMobile } from '@/hooks/useIsMobile';

interface AvatarWithBadgeProps {
  imageUrl?: string | null;
  alt?: string;
  size: number; // avatar diameter in pixels
  /** The user's currently equipped badge id, or null/undefined for none. */
  equippedBadge?: string | null;
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
  className = '',
  ringClassName = '',
  fallbackSrc = '/banana-profile.png',
  useNextImage = true,
}: AvatarWithBadgeProps) {
  // Track image load failure so a broken/glitched pfp URL falls back to
  // the banana instead of rendering a broken image.
  const [loadFailed, setLoadFailed] = useState(false);
  // Reset the failure flag if the image URL changes (e.g. user updates pfp).
  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  const isMobile = useIsMobile();
  const isFallback = !imageUrl || loadFailed;
  const src = isFallback ? fallbackSrc : imageUrl;
  // Mobile tiles pack the name close under the avatar, so the badge is a touch
  // smaller (52% vs 54%) and pokes DOWN less there — keeping it off the name
  // while staying in the same bottom-right spot as desktop.
  const badgeSize = Math.min(40, Math.max(12, Math.round(size * 0.44)));
  // Badge sits at the bottom-right, poking just slightly past the circle. Kept
  // small so it stays in the corner (not creeping toward the face). Mobile pokes
  // DOWN a touch less so it clears the name on the tight tiles.
  const edgeOffsetX = Math.round(size * 0.076);
  const edgeOffsetY = Math.round(size * (isMobile ? 0.05 : 0.076));
  const badge = equippedBadge ? BADGE_BY_ID[equippedBadge] : undefined;
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
      className={`relative inline-block flex-shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
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
      {badge && (
        <span
          className="absolute pointer-events-auto"
          style={{
            right: -edgeOffsetX,
            bottom: -edgeOffsetY,
            width: badgeSize,
            height: badgeSize,
          }}
        >
          <BadgeIcon badge={badge} size={badgeSize} unlocked plain showTooltip={false} />
        </span>
      )}
      {/* Border ring drawn LAST (on top of the badge) so it's always a complete
          circle — the badge pokes slightly past it but can't erase it. */}
      {ringClassName && (
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full pointer-events-none ${ringClassName}`}
        />
      )}
    </div>
  );
}
