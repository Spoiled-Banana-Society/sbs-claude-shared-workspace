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
 * overlay at the bottom-right. The badge size scales to roughly 44% of
 * the avatar diameter (clamped at 12px min, 40px max) so it stands out.
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
  const badgeSize = Math.min(40, Math.max(12, Math.round(size * 0.44)));
  const badge = equippedBadge ? BADGE_BY_ID[equippedBadge] : undefined;
  // The fallback banana PNG is cropped edge-to-edge so it looks visually
  // larger than custom PFPs (which typically have whitespace padding in
  // the source). Shrink the fallback so it sits at the same visual weight
  // as a normal user-uploaded avatar.
  const innerSize = isFallback ? Math.round(size * 0.85) : size;
  const innerOffset = Math.round((size - innerSize) / 2);

  // Badge sits flush at the bottom-right corner INSIDE the avatar's
  // bounding box. This way an `overflow-hidden` on a parent slot (e.g.
  // the draft-room cards) doesn't clip the badge.
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
            right: 0,
            bottom: 0,
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
