'use client';

// Default banana bg — lighter slate options so the color actually shows on the
// dark draft cards. In real card context. Local preview.

import React from 'react';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';

const TYPE_BAR = 'linear-gradient(90deg,#ef4444,#22c55e,#a855f7,#3b82f6,#f59e0b)';

const BGS = [
  { name: 'Current slate (too dark)', src: '/banana-profile.png' },
  { name: 'Slate medium', src: '/_bgtest/banana-slatemed.png', pick: true },
  { name: 'Slate light', src: '/_bgtest/banana-slatelt.png' },
  { name: 'Slate bright', src: '/_bgtest/banana-slatebright.png' },
  { name: 'Navy medium', src: '/_bgtest/banana-navymed.png' },
  { name: 'Blue-grey', src: '/_bgtest/banana-bluegrey.png' },
];

function Card({ src, you }: { src: string; you?: boolean }) {
  return (
    <div style={{ width: 132, borderRadius: 6, border: `2px solid ${you ? '#F3E216' : '#3a3a3f'}`, background: '#222', padding: '12px 0 0', overflow: 'hidden' }}>
      <div className="flex justify-center">
        <AvatarWithBadge imageUrl={src} size={48} equippedBadge="ripeness-unripe" useNextImage={false}
          ringClassName={you ? 'border-2 border-[#F3E216]' : ''} badgeRingColor="#222" />
      </div>
      <div className="mt-2 font-bold text-[13px] text-center" style={{ color: '#fff' }}>Banana10003</div>
      <div className="text-[11px] text-center" style={{ color: '#9ca3af' }}>R9 · P81</div>
      <div style={{ height: 3, marginTop: 8, background: TYPE_BAR }} />
    </div>
  );
}

export default function BadgeSizes() {
  return (
    <div style={{ background: '#08080a', minHeight: '100vh', padding: 24, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Default banana background — make the color visible</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, maxWidth: 840 }}>
        On the dark draft card, the current slate is too dark to read. Lighter options actually show
        the color + make the avatar pop off the card. None clash with badge colors or green.
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 18 }}>
        {BGS.map(bg => (
          <div key={bg.name} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: bg.pick ? '#9fb4cc' : bg.name.includes('Current') ? '#9ca3af' : '#cbd5e1', marginBottom: 8 }}>{bg.name}{bg.pick ? ' ★' : ''}</div>
            <Card src={bg.src} you={bg.pick} />
          </div>
        ))}
      </div>
    </div>
  );
}
