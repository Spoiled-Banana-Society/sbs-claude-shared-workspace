'use client';

// Temporary visual test page for the obsidian-disc badge system. Public route
// (no auth) so it can be screenshotted on staging. Safe to delete.

import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { RIPENESS_LADDER } from '@/lib/badges/ripeness';

const APE = 'https://storage.googleapis.com/sbs-staging-pfps/0x438bbe98eed1dd2df244b007dab0583cc9be72e0.jpg';

// One representative of each non-team badge + a couple of teams.
const SHOWCASE = BADGE_CATALOG.filter(
  b => b.category !== 'team' || ['team-kc', 'team-sf'].includes(b.id),
);

export default function TestBadges() {
  return (
    <div style={{ background: '#08080a', minHeight: '100vh', padding: 40, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Obsidian-disc badges — real component</h1>

      <h2 style={{ fontSize: 15, color: '#fbbf24', marginTop: 28 }}>Ripeness ladder (banana recolors by tier)</h2>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 12 }}>
        {RIPENESS_LADDER.map(r => (
          <div key={r.tier} style={{ textAlign: 'center' }}>
            <BadgeIcon badge={BADGE_CATALOG[0]} size={72} ripeness={r} showTooltip={false} />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>{r.label}<br />{r.range}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: '#fbbf24', marginTop: 32 }}>Catalog size (72px) · unlocked vs locked</h2>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 12 }}>
        {SHOWCASE.map(b => (
          <div key={b.id} style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <BadgeIcon badge={b} size={72} showTooltip={false} />
              <BadgeIcon badge={b} size={72} unlocked={false} showTooltip={false} />
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, maxWidth: 154 }}>{b.label}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: '#fbbf24', marginTop: 32 }}>On avatars (corner overlay)</h2>
      {[36, 48, 64, 96].map(size => (
        <div key={size} style={{ display: 'flex', gap: 36, alignItems: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
          {SHOWCASE.map(b => (
            <div key={b.id} style={{ textAlign: 'center' }}>
              <AvatarWithBadge imageUrl={APE} size={size} equippedBadge={b.id} useNextImage={false} />
              <div style={{ fontSize: 9, color: '#6b7280', marginTop: 6, maxWidth: 90 }}>{b.label} · {size}px</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
