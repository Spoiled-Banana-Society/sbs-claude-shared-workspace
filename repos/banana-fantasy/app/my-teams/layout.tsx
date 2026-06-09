import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Teams',
  description:
    'View your Banana Fantasy teams, roster performance, and public leaderboards across contests.',
  alternates: {
    canonical: '/my-teams',
  },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
