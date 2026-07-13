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

  // Per-promo reward framing. Each Banana Wheel spin wins up to 20 Free Drafts
  // (guaranteed at least 1), so the totals scale with how many spins the promo
  // awards: Jackpot Hit pays up to 10 spins (200 drafts, min 5); Refer Friend
  // pays up to 3 spins per friend (60 drafts, min 3); everything else is a
  // single spin (20 drafts, min 1). Title-based with a graceful 20/1 fallback.
  const t = (promoTitle || '').toLowerCase();
  let maxDrafts = 20;
  let guaranteed = 1;
  if (t.includes('jackpot')) {
    maxDrafts = 200;
    guaranteed = 5;
  } else if (t.includes('refer')) {
    maxDrafts = 60;
    guaranteed = 3;
  }

  return (
    <span className={className}>
      Win up to <strong className="font-semibold">{maxDrafts} Free Drafts</strong> — guaranteed at least {guaranteed}
    </span>
  );
}
