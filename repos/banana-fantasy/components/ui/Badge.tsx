'use client';

import React from 'react';

type BadgeType = 'jackpot' | 'hof' | 'pro' | 'jackhof' | 'default';

interface BadgeProps {
  type: BadgeType;
  children: React.ReactNode;
  className?: string;
}

const badgeStyles: Record<BadgeType, string> = {
  jackpot: 'bg-jackpot/20 text-jackpot border border-jackpot/30',
  hof: 'bg-hof/20 text-hof border border-hof/30',
  pro: 'bg-pro/20 text-pro border border-pro/30',
  // Dual-type (Jackpot + HOF on one draft): red→gold wash, red border edge.
  jackhof: 'bg-gradient-to-r from-jackpot/20 to-hof/20 text-hof border border-jackpot/40',
  default: 'bg-bg-tertiary text-text-secondary border border-bg-elevated',
};

export function Badge({ type, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
        ${badgeStyles[type]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
