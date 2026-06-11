'use client';

// Founder banner preview (TEMP — safe to delete). Forced-visible variants +
// link to the FAQ explainer it clicks through to.

import { useRouter } from 'next/navigation';
import { FounderDraftCard } from '@/components/home/TopBanners';

export default function TestBanners() {
  const router = useRouter();
  const fdBase = {
    dismiss: () => {},
    learnMore: () => router.push('/faq#founder-draft'),
    show: true,
  };
  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh', padding: '36px 20px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Founder Draft banner — preview</h1>
        <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 26 }}>
          Exactly the card users see in the top banner row (home) and on the drafting page.
          Click the card or &quot;How It Works&quot; — it opens the real FAQ section.
        </p>

        <h2 style={{ color: '#fbbf24', fontSize: 14, margin: '20px 0 8px' }}>Tuesday (day before)</h2>
        <FounderDraftCard fd={{ ...fdBase, isToday: false, timeLabel: '6 PM PT' } as never} />

        <h2 style={{ color: '#fbbf24', fontSize: 14, margin: '26px 0 8px' }}>Wednesday (day of)</h2>
        <FounderDraftCard fd={{ ...fdBase, isToday: true, timeLabel: '6 PM PT' } as never} />

        <h2 style={{ color: '#fbbf24', fontSize: 14, margin: '32px 0 8px' }}>The click-through info</h2>
        <p style={{ color: '#9ca3af', fontSize: 13 }}>
          Tapping the banner opens <a href="/faq#founder-draft" style={{ color: '#fbbf24' }}>/faq#founder-draft</a> —
          the Founder Drafts section auto-expands with: what it is, what you win (Free Spin + Founders badge,
          paid entries only), how to get in at 6 PM PT, and the beat-the-founder skip-to-finals perk.
        </p>
      </div>
    </div>
  );
}
