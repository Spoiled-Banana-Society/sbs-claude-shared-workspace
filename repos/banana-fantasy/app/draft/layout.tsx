import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Drafting Lobby',
  description:
    'Join active Banana Fantasy best ball drafts, track live draft progress, and manage your current entries.',
  alternates: {
    canonical: '/draft',
  },
};

export default function DraftingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
