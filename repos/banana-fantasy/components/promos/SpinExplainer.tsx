'use client';

import React from 'react';
import { promoAwardsSpin } from '@/lib/promoMath';

// Short "what's a spin?" explainer shown on spin-awarding promo cards.
//
// Boris 2026-06-24: this copy now stays on EVERY spin-awarding promo box,
// ALWAYS, for ALL users — new AND returning, even after they've taken their
// first spin. (Previously it self-gated off for BB3 returning players and for
// anyone who'd already spun, which made it vanish from every box once a user
// completed the new-user promo.) The new-user promo BOX itself still leaves
// after claim via the separate promo filter — that's unchanged; this only
// governs the tagline inside the spin promos that remain.
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
  if (!promoAwardsSpin(promoTitle)) return null;

  return (
    <span className={className}>
      Win up to <strong className="font-semibold">20 Free Drafts</strong> — guaranteed at least 1
    </span>
  );
}
