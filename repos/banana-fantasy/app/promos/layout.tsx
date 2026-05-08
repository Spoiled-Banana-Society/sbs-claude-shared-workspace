import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Promos | Banana Fantasy',
  description:
    'Every active Banana Fantasy promo in one place — daily drafts, pick-10 wins, referral rewards, and more.',
  alternates: {
    canonical: '/promos',
  },
};

export default function PromosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
