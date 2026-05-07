'use client';

import React from 'react';
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
 * overlay at the bottom-right. The badge size scales to roughly 38% of
 * the avatar diameter (clamped at 12px min, 32px max).
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
  const src = imageUrl || fallbackSrc;
  const badgeSize = Math.min(32, Math.max(12, Math.round(size * 0.38)));
  const badge = equippedBadge ? BADGE_BY_ID[equippedBadge] : undefined;

  return (
    <div
      className={`relative inline-block flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {useNextImage ? (
        <Image
          src={src}
          alt={alt}
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
          unoptimized
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      )}
      {badge && (
        <span
          className="absolute pointer-events-auto"
          style={{
            right: -Math.round(badgeSize * 0.15),
            bottom: -Math.round(badgeSize * 0.15),
            width: badgeSize,
            height: badgeSize,
          }}
        >
          <BadgeIcon badge={badge} size={badgeSize} unlocked />
        </span>
      )}
    </div>
  );
}
