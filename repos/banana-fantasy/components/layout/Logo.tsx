'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** Hide the "SBS" wordmark below `sm` — the header row physically cannot
   *  fit wordmark + lane pills + balance chip + ticket + avatar on a phone
   *  (Richard 2026-07-21). Glyph alone still reads as the brand. */
  compactMobile?: boolean;
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 52,
};

export function Logo({ size = 'md', compactMobile = false }: LogoProps) {
  const imgSize = sizeMap[size];
  // Polymarket-style lockup, tuned for all-caps 3-letter wordmark:
  // text ~45% of icon height (all-caps reads ~20% larger than mixed-case),
  // tight 4px gap, bold (not black) so letters don't feel chunky.
  const fontSize = Math.round(imgSize * 0.45);

  return (
    <Link href="/" className="flex items-center gap-0 transition-transform hover:scale-105">
      <Image
        src="/sbs-logo.png"
        alt="SBS Fantasy"
        width={imgSize}
        height={imgSize}
        priority
      />
      <span
        className={`-ml-1.5 font-bold tracking-tight leading-none text-white ${compactMobile ? 'hidden sm:block' : ''}`}
        style={{ fontSize: `${fontSize}px` }}
      >
        SBS
      </span>
    </Link>
  );
}
