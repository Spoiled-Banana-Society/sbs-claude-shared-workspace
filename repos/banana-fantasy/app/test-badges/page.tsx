'use client';

import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';

// Temporary visual test page for badge rendering across avatar sizes + types.
// Public route (no auth) so it can be screenshotted on staging. Safe to delete.

const APE = 'https://storage.googleapis.com/sbs-staging-pfps/0x438bbe98eed1dd2df244b007dab0583cc9be72e0.jpg';
const BANANA = '/banana-profile.png';

const BADGES: Array<{ id: string; label: string }> = [
  { id: 'team-kc', label: 'Chiefs (team logo)' },
  { id: 'drafts-20', label: 'Veteran ⚔️ (gradient)' },
  { id: 'drafts-100', label: 'Centurion 💯 (gradient)' },
  { id: 'first-draft', label: 'First 🌱 (plain emoji)' },
  { id: 'beat-founder', label: 'Beat Founder (gradient)' },
  { id: 'spin-jackpot', label: 'Spin JP' },
];

const SIZES = [36, 48, 64];

export default function TestBadges() {
  return (
    <div style={{ background: '#0b0b0b', minHeight: '100vh', padding: 40, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Badge render test (real component)</h1>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>How each badge actually sits, on the ape and the new banana, at every avatar size.</p>
      {[{ url: APE, who: 'Ape (upload)' }, { url: BANANA, who: 'Banana (default)' }].map(av => (
        <div key={av.who} style={{ marginTop: 28 }}>
          <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 10 }}>{av.who}</div>
          {SIZES.map(size => (
            <div key={size} style={{ display: 'flex', gap: 40, alignItems: 'flex-end', marginBottom: 26, flexWrap: 'wrap' }}>
              {BADGES.map(b => (
                <div key={b.id} style={{ textAlign: 'center' }}>
                  <AvatarWithBadge imageUrl={av.url} size={size} equippedBadge={b.id} useNextImage={false} />
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6, maxWidth: 90 }}>{b.label} · {size}px</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
