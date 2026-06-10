'use client';

// Badges-tab LAYOUT options (Boris 2026-06-10) — pick one, then it ships.
// Uses the REAL KingLeaderboard + BadgeCatalogGrid components with live data,
// arranged three different ways. TEMP page — delete once a direction is chosen.

import React, { useState } from 'react';
import { KingLeaderboard } from '@/components/badges/KingLeaderboard';
import { BadgeCatalogGrid } from '@/components/badges/BadgeCatalogGrid';
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

const OPTIONS = [
  { key: 'a', label: 'A — King on top (today, polished)' },
  { key: 'b', label: 'B — Badges first, King below' },
  { key: 'c', label: 'C — Side by side (desktop)' },
] as const;

function CompactKingStrip() {
  // Option B teaser strip — tap-to-scroll feel; the full panel lives below.
  return (
    <button
      type="button"
      onClick={() => document.getElementById('king-full')?.scrollIntoView({ behavior: 'smooth' })}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 mb-6 text-left"
      style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)' }}
    >
      <BadgeIcon badge={BADGE_BY_ID['king-of-drafts']} size={34} unlocked showTooltip={false} />
      <div className="flex-1">
        <div className="text-white text-[14px] font-semibold">King of Drafts</div>
        <div className="text-white/40 text-[11px]">This week&apos;s race — most paid drafts filled takes the crown</div>
      </div>
      <span className="text-banana text-[12px] font-semibold">View race ↓</span>
    </button>
  );
}

export default function TestBadgeLayouts() {
  const [opt, setOpt] = useState<(typeof OPTIONS)[number]['key']>('a');

  return (
    <div style={{ background: '#060608', minHeight: '100vh', padding: '28px 18px', maxWidth: 1150, margin: '0 auto' }}>
      <h1 className="text-white text-xl font-bold mb-1">Badges tab layout — pick an option</h1>
      <p className="text-white/40 text-[13px] mb-5">
        Real components, live data — exactly how the badges tab would look. Switch options below.
      </p>

      <div className="flex gap-2 mb-8 flex-wrap">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setOpt(o.key)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-all border ${
              opt === o.key
                ? 'bg-banana text-black border-banana'
                : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {opt === 'a' && (
        <div>
          <p className="text-white/30 text-[12px] mb-4">King panel leads (with the badge + how-it-works line), catalog under it.</p>
          <KingLeaderboard />
          <BadgeCatalogGrid />
        </div>
      )}

      {opt === 'b' && (
        <div>
          <p className="text-white/30 text-[12px] mb-4">Your badges come first; a slim King strip teases the race and the full panel sits at the bottom.</p>
          <CompactKingStrip />
          <BadgeCatalogGrid />
          <div id="king-full" className="mt-8">
            <KingLeaderboard />
          </div>
        </div>
      )}

      {opt === 'c' && (
        <div>
          <p className="text-white/30 text-[12px] mb-4">Two columns on desktop — catalog left, King race pinned right (stacks on mobile).</p>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
            <div><BadgeCatalogGrid /></div>
            <div className="lg:sticky lg:top-6"><KingLeaderboard /></div>
          </div>
        </div>
      )}
    </div>
  );
}
