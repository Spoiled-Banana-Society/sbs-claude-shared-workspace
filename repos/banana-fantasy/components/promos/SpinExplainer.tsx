'use client';

import React from 'react';
import { promoAwardsSpin } from '@/lib/promoMath';

// Short "what's a spin?" explainer shown on the NEW-USER promo card only.
//
// Boris 2026-08-06: this line now renders ONLY on the new-user promo —
// every other promo card drops it (supersedes the 2026-06-24 rule that kept
// it on every spin-awarding box; the cards got too text-heavy once several
// spin promos ran at once). Callers pass promoType; anything except
// 'new-user' renders nothing.
export function SpinExplainer({
  promoTitle,
  promoType,
  className = '',
}: {
  promoTitle?: string;
  promoType?: string;
  className?: string;
}) {
  if (promoType !== 'new-user') return null;
  if (!promoAwardsSpin(promoTitle)) return null;

  // Per-promo reward framing. Each Banana Wheel spin wins up to 20 Free Drafts
  // (guaranteed at least 1), so the totals scale with how many spins the promo
  // awards: Jackpot Hit pays up to 10 spins (200 drafts, min 5); Refer Friend
  // pays up to 3 spins per friend (60 drafts, min 3); Chase Your Pick pays up to
  // 5 spins per hit (100 drafts, min 1); everything else is a single spin (20
  // drafts, min 1). Title-based with a graceful 20/1 fallback.
  const t = (promoTitle || '').toLowerCase();
  let maxDrafts = 20;
  let guaranteed = 1;
  if (t.includes('jackpot')) {
    maxDrafts = 200;
    guaranteed = 5;
  } else if (t.includes('refer')) {
    maxDrafts = 60;
    guaranteed = 3;
  } else if (t.includes('match your pick')) {
    // Match Your Pick pays up to 5 Spins per hit → up to 100 Free Drafts.
    maxDrafts = 100;
    guaranteed = 1;
  }

  return (
    <span className={className}>
      Win up to <strong className="font-semibold">{maxDrafts} Free Drafts</strong> — guaranteed at least {guaranteed}
    </span>
  );
}
