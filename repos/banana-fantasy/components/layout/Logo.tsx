'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 52,
};

export function Logo({ size = 'md' }: LogoProps) {
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
        className="-ml-1.5 font-bold tracking-tight leading-none text-white"
        style={{ fontSize: `${fontSize}px` }}
      >
        SBS
      </span>
    </Link>
  );
}
