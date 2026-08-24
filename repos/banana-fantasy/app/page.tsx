'use client';

// The homepage body lives in components/home/HomePageContent.tsx (Next.js
// forbids extra named exports on page files). promoUi="grid" = the /promos
// rectangle cards, approved by Richard 2026-08-23 after review at
// /preview/home; the old left/right PromoCarousel is retired from this page.
import { HomePageContent } from '@/components/home/HomePageContent';

export default function HomePage() {
  return <HomePageContent promoUi="grid" />;
}
