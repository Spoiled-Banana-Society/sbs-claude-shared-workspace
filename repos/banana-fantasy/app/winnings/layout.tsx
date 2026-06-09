import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prizes',
  description:
    'Explore Banana Fantasy prize structures, payout tiers, and contest rewards for best ball entries.',
  alternates: {
    canonical: '/winnings',
  },
};

export default function PrizesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
