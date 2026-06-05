'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { BadgeIcon } from './BadgeIcon';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

interface AvatarWithBadgeProps {
  imageUrl?: string | null;
  alt?: string;
  size: number; // avatar diameter in pixels
  /** The user's currently equipped badge id, or null/undefined for none. */
  equippedBadge?: string | null;
  /** Optional CSS class overrides for the wrapper. */
  className?: string;
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

  const isFallback = !imageUrl || loadFailed;
  const src = isFallback ? fallbackSrc : imageUrl;
  const badgeSize = Math.min(44, Math.max(12, Math.round(size * 0.54)));
  // Nudge the badge onto the avatar's bottom-right rim (it pokes slightly past
  // the circle into the empty box corner, like Underdog/Discord status dots) so
  // it stands out without sitting on the face. Scales with the avatar so the
  // look is consistent everywhere (~7px out on a 48px draft-card avatar).
  const edgeOffset = Math.round(size * 0.146);
  const badge = equippedBadge ? BADGE_BY_ID[equippedBadge] : undefined;
  // The fallback banana PNG is cropped edge-to-edge so it looks visually
  // larger than custom PFPs (which typically have whitespace padding in
  // the source). Shrink the fallback so it sits at the same visual weight
  // as a normal user-uploaded avatar.
  const innerSize = isFallback ? Math.round(size * 0.85) : size;
  const innerOffset = Math.round((size - innerSize) / 2);

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
            right: -edgeOffset,
            bottom: -edgeOffset,
            width: badgeSize,
            height: badgeSize,
          }}
        >
          <BadgeIcon badge={badge} size={badgeSize} unlocked plain showTooltip={false} />
        </span>
      )}
    </div>
  );
}
