'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { promoAwardsSpin } from '@/lib/promoMath';

// Short "what's a spin?" explainer shown on spin-awarding promo cards for
// NEW users only — anyone who hasn't spun the Banana Wheel yet and isn't a
// returning BB3 player. Self-gates (no prop threading): once the user takes
// their first spin (user.hasSpunWheel flips true) it disappears everywhere.
//
// Pass the promo title so it only renders on spin promos, and a className so
// each surface can colour it for its card (light vs dark).
export function SpinExplainer({
  promoTitle,
  className = '',
}: {
  promoTitle?: string;
  className?: string;
}) {
  const { user, isBB3Holder } = useAuth();

  if (!promoAwardsSpin(promoTitle)) return null;
  if (isBB3Holder) return null; // returning players already know
  if (user?.hasSpunWheel) return null; // they've spun — no need to explain

  return (
    <span className={className}>
      Win up to <strong className="font-semibold">20 Free Drafts</strong> — guaranteed at least 1
    </span>
  );
}
