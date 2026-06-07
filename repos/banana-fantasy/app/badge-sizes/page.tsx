'use client';

// Draft-box ONLY: badge size variations (current vs tad bigger vs bigger).
// Shown on a "you" card + an "other" card. Local preview only.

import React from 'react';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';

const APE = 'https://storage.googleapis.com/sbs-staging-pfps/0x438bbe98eed1dd2df244b007dab0583cc9be72e0.jpg';
const TYPE_BAR = 'linear-gradient(90deg,#ef4444,#22c55e,#a855f7,#3b82f6,#f59e0b)';

const SCALES = [
  { name: 'Current', s: 20 / 48 },
  { name: '22px', s: 22 / 48 },
  { name: '23px', s: 23 / 48 },
  { name: 'Tad bigger', s: 24 / 48 },
  { name: 'Bigger', s: 28 / 48 },
  { name: 'Biggest', s: 32 / 48 },
];

function Card({ you, name, badge, scale }: { you?: boolean; name: string; badge: string; scale: number }) {
  return (
    <div style={{ width: 150, borderRadius: 6, border: `2px solid ${you ? '#F3E216' : '#444'}`, background: '#222', padding: '12px 0 0', overflow: 'hidden' }}>
      <div className="flex justify-center">
        <AvatarWithBadge imageUrl={APE} size={48} equippedBadge={badge} useNextImage={false}
          ringClassName={you ? 'border-2 border-[#F3E216]' : ''} badgeRingColor="#222" badgeScale={scale} badgeMax={64} />
      </div>
      <div className="mt-2 font-bold text-[11px] lg:text-[14px] text-center" style={{ color: '#fff' }}>{name}</div>
      <div className="text-[11px] text-center" style={{ color: '#9ca3af' }}>R2 · P19</div>
      <div style={{ height: 3, marginTop: 8, background: TYPE_BAR }} />
      <div style={{ fontSize: 10, color: '#cbd5e1', textAlign: 'center', padding: '6px 0 8px' }}>QB RB WR TE DST</div>
    </div>
  );
}

export default function BadgeSizes() {
  return (
    <div style={{ background: '#08080a', minHeight: '100vh', padding: 24, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Draft box — badge size options</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, maxWidth: 840 }}>
        Draft box only. Each row is a badge size on a real card (your card + another player&apos;s).
        Avatar stays 48px; just the badge grows. Open on phone for mobile too.
      </p>
      {SCALES.map(sc => (
        <div key={sc.name} style={{ marginTop: 22 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: sc.name === 'Current' ? '#9ca3af' : '#5fd3c4' }}>
            {sc.name} <span style={{ color: '#6b7280', fontWeight: 400 }}>(badge {Math.round(48 * sc.s)}px)</span>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <Card name="Banana10005" badge="ripeness-fresh" scale={sc.s} />
            <Card you name="Banana67705" badge="ripeness-spoiled" scale={sc.s} />
            <Card name="BananaKing99" badge="hof-club" scale={sc.s} />
          </div>
        </div>
      ))}
    </div>
  );
}
