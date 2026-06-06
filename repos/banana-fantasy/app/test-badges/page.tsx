'use client';

// Badge size comparison — real <AvatarWithBadge> at the exact avatar sizes
// used across the site, at the current badge scale vs bigger options. Public
// route so it can be screenshotted on staging. Safe to delete.

import React from 'react';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { RIPENESS_LADDER } from '@/lib/badges/ripeness';

const APE = 'https://storage.googleapis.com/sbs-staging-pfps/0x438bbe98eed1dd2df244b007dab0583cc9be72e0.jpg';

// The real avatar diameters used around the site.
const CONTEXTS = [
  { label: 'Profile page', size: 80 },
  { label: 'Draft box', size: 48 },
  { label: 'Roster', size: 40 },
  { label: 'Header', size: 36 },
  { label: 'Board', size: 32 },
];

// Size options to compare. Current = what's live now.
const OPTIONS = [
  { name: 'Current', scale: 0.44, max: 40 },
  { name: 'Bigger (+25%)', scale: 0.55, max: 48 },
  { name: 'Biggest (+50%)', scale: 0.66, max: 56 },
];

function badgePx(size: number, scale: number, max: number) {
  return Math.min(max, Math.max(12, Math.round(size * scale)));
}

// A few representative equipped badges to preview (default banana = no equip).
const SAMPLES: Array<{ label: string; equipped?: string }> = [
  { label: 'Default banana (Spoiled)', equipped: 'ripeness-spoiled' },
  { label: 'HOF Club (gold)', equipped: 'hof-club' },
  { label: 'BBB I Champion', equipped: 'bbb-champion-1' },
  { label: 'Chiefs', equipped: 'team-kc' },
];

export default function TestBadges() {
  return (
    <div style={{ background: '#08080a', minHeight: '100vh', padding: 32, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Badge size comparison (real component)</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, maxWidth: 760 }}>
        Each row is an avatar size used on the site. Columns are size options. The number under
        each is the badge&apos;s exact pixel diameter. Sizes are identical on mobile + desktop — only
        the page layout differs.
      </p>

      {SAMPLES.map(sample => (
        <div key={sample.label} style={{ marginTop: 34 }}>
          <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 12 }}>{sample.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(3, 1fr)', gap: 16, alignItems: 'center', maxWidth: 720 }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>context ↓ / option →</div>
            {OPTIONS.map(o => (
              <div key={o.name} style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{o.name}</div>
            ))}
            {CONTEXTS.map(ctx => (
              <React.Fragment key={ctx.label}>
                <div style={{ fontSize: 12, color: '#cbd5e1' }}>{ctx.label}<br /><span style={{ color: '#6b7280' }}>{ctx.size}px</span></div>
                {OPTIONS.map(o => (
                  <div key={o.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0' }}>
                    <AvatarWithBadge
                      imageUrl={APE}
                      size={ctx.size}
                      equippedBadge={sample.equipped}
                      badgeScale={o.scale}
                      badgeMax={o.max}
                      useNextImage={false}
                    />
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{badgePx(ctx.size, o.scale, o.max)}px</div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 15, color: '#fbbf24', marginTop: 40 }}>The 6 banana tiers (locked vs unlocked)</h2>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12 }}>
        {RIPENESS_LADDER.map((r, i) => {
          const b = BADGE_CATALOG.find(x => x.id === `ripeness-${r.label.toLowerCase()}`)!;
          return (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <BadgeIcon badge={b} size={64} showTooltip={false} />
                <BadgeIcon badge={b} size={64} unlocked={false} showTooltip={false} />
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>{r.label}<br />{r.range}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
