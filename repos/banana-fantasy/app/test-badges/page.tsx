'use client';

// Badge / avatar size comparison — the REAL <AvatarWithBadge> component (so
// it renders exactly as it will on the site, accurate on mobile + desktop).
// Shows the draft-box player card at several avatar sizes, for both a real
// photo and the default banana profile pic. Public route. Safe to delete.

import React from 'react';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { RIPENESS_LADDER } from '@/lib/badges/ripeness';

const APE = 'https://storage.googleapis.com/sbs-staging-pfps/0x438bbe98eed1dd2df244b007dab0583cc9be72e0.jpg';
const BANANA = '/banana-profile.png'; // the default profile pic (no upload)
const TYPE_BAR = 'linear-gradient(90deg,#ef4444,#22c55e,#a855f7,#3b82f6,#f59e0b)';

const AVATAR_SIZES = [48, 64, 80, 96]; // 48 = current
const AVATAR_IMAGES = [
  { label: 'Your photo', url: APE },
  { label: 'Default banana pic', url: BANANA },
];

function badgePx(size: number, scale = 0.44, max = 64) {
  return Math.min(max, Math.max(12, Math.round(size * scale)));
}

// A real-looking draft-box player card (matches the in-draft card styling).
function DraftCard({
  avatarSize, imageUrl, equipped, you = false, name = 'Boris',
}: { avatarSize: number; imageUrl: string; equipped?: string; you?: boolean; name?: string }) {
  const cardW = Math.max(120, avatarSize + 48);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: cardW,
        borderRadius: 10,
        border: `2px solid ${you ? '#F3E216' : '#444'}`,
        background: '#1c1c1f',
        padding: '14px 0 0',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <AvatarWithBadge
            imageUrl={imageUrl}
            size={avatarSize}
            equippedBadge={equipped}
            badgeMax={64}
            ringClassName={you ? 'border-2 border-[#F3E216]' : ''}
            useNextImage={false}
          />
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10, color: '#fff' }}>{name}</div>
        <div style={{ color: '#9ca3af', fontSize: 11 }}>R1 · P7</div>
        <div style={{ height: 3, marginTop: 10, background: TYPE_BAR }} />
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>
        avatar {avatarSize}px · badge {badgePx(avatarSize)}px
      </div>
    </div>
  );
}

// Different equipped badges, previewed at one size for both avatar images.
const BADGE_SAMPLES: Array<{ label: string; equipped?: string }> = [
  { label: 'Default banana', equipped: 'ripeness-spoiled' },
  { label: 'HOF Club', equipped: 'hof-club' },
  { label: 'BBB I Champion', equipped: 'bbb-champion-1' },
  { label: 'Chiefs', equipped: 'team-kc' },
];

export default function TestBadges() {
  return (
    <div style={{ background: '#08080a', minHeight: '100vh', padding: 24, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Draft box — avatar size options</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, maxWidth: 820 }}>
        This is the <b>real component</b>, so it looks exactly like the live site. <b>Open this page
        on your phone for the mobile view and on desktop for the desktop view</b> — both are accurate
        because it&apos;s the actual code. <b>48px is current</b>; 64 / 80 / 96 are the bigger options.
        The badge scales with the avatar (sizes labeled under each card).
      </p>

      {AVATAR_IMAGES.map(img => (
        <div key={img.label} style={{ marginTop: 30 }}>
          <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 12, fontSize: 16 }}>{img.label}</div>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {AVATAR_SIZES.map(size => (
              <div key={size}>
                <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 8, textAlign: 'center' }}>
                  {size === 48 ? '48px (current)' : `${size}px`}
                </div>
                <DraftCard avatarSize={size} imageUrl={img.url} equipped="ripeness-spoiled" you />
              </div>
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 16, color: '#fbbf24', marginTop: 46 }}>How each badge looks in the draft box (at 80px)</h2>
      <p style={{ color: '#9ca3af', fontSize: 12, maxWidth: 760 }}>
        A few different equipped badges, on your photo and on the default banana pic.
      </p>
      {AVATAR_IMAGES.map(img => (
        <div key={img.label} style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10 }}>{img.label}</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {BADGE_SAMPLES.map(s => (
              <div key={s.label}>
                <DraftCard avatarSize={80} imageUrl={img.url} equipped={s.equipped} name={s.label} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 15, color: '#fbbf24', marginTop: 46 }}>The 6 banana tiers (locked vs unlocked)</h2>
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
