import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wallet',
  description:
    'Your Banana Fantasy balance — prizes, team-sale proceeds, and credit. Cash out to your bank.',
  alternates: {
    canonical: '/winnings',
  },
};

export default function PrizesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
