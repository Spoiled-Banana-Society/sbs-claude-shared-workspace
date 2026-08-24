'use client';

/**
 * /preview/home — the real homepage with the NEW promo section: the /promos
 * rectangle cards (PromoLongCard grid) instead of the left/right carousel
 * (Richard 2026-08-23). Fully live and interactive — same data, same claims —
 * so it can be reviewed at a real URL before app/page.tsx flips to the grid.
 */

import { HomePageContent } from '@/components/home/HomePageContent';

export default function PreviewHomePage() {
  return <HomePageContent promoUi="grid" />;
}
