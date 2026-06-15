/**
 * Cross-links between the three pre-draft pages: Drafts, Rankings, Draft
 * Alerts. Renders the OTHER two sections as quiet text links beside a page's
 * title, so a user can hop between them from any of the three (previously
 * only the /draft page had these links).
 *
 * Style matches the quiet links already on /draft. Uses next/link (no client
 * hooks) so it works inside a server component, and the parent row should use
 * flex-wrap so the links drop below the title on narrow / mobile widths.
 */

import Link from 'next/link';

export type DraftSection = 'draft' | 'rankings' | 'alerts';

const ITEMS: { key: DraftSection; label: string; href: string; aria: string }[] = [
  { key: 'draft', label: 'Drafts', href: '/draft', aria: 'Browse and enter drafts' },
  { key: 'rankings', label: 'Rankings', href: '/rankings', aria: 'Pre-rank players and set auto-draft limits' },
  {
    key: 'alerts',
    label: 'Draft Alerts',
    href: '/notifications/settings',
    aria: "Set up draft alerts — get notified when your draft starts and when it's your pick",
  },
];

export function DraftSectionLinks({ active }: { active: DraftSection }) {
  return (
    <>
      {ITEMS.filter((i) => i.key !== active).map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-label={i.aria}
          className="text-sm font-medium text-white/45 hover:text-banana transition-colors"
        >
          {i.label}
        </Link>
      ))}
    </>
  );
}
