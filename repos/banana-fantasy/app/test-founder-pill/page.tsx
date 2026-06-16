'use client';

/**
 * TEMP mockup (/test-founder-pill) — shows the cyan FOUNDER pill exactly as it
 * renders in the draft-room top band, next to each draft type (PRO/HOF/JACKPOT).
 * Uses the real draftBandStyle so it matches the live draft room 1:1.
 */

import React from 'react';
import {
  draftBandBackground,
  draftBandShadow,
  draftWordColor,
  draftWordShadow,
} from '@/lib/draftBandStyle';

const FOUNDER_CYAN = '#06b6d4';

function FounderPillMock() {
  // Identical markup/size to the real FounderPill (size="md") + the band's
  // cyan drop-shadow glow wrapper.
  return (
    <div className="flex items-center" style={{ filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.55))' }}>
      <span
        className="text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider"
        style={{ background: `${FOUNDER_CYAN}33`, color: FOUNDER_CYAN, border: `1px solid ${FOUNDER_CYAN}55` }}
      >
        Founder
      </span>
    </div>
  );
}

function BandRow({ type, word }: { type: 'pro' | 'hof' | 'jackpot'; word: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-2"
      style={{
        background: draftBandBackground(type),
        boxShadow: draftBandShadow(type),
        borderBottom: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      <span
        className="font-black uppercase mr-2"
        style={{
          fontSize: '18px',
          lineHeight: 1,
          letterSpacing: '0.14em',
          color: draftWordColor(type),
          textShadow: draftWordShadow(type),
        }}
      >
        {word}
      </span>
      <FounderPillMock />
    </div>
  );
}

export default function TestFounderPill() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white px-4 py-10">
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">FOUNDER pill — color + placement</h1>
          <p className="text-white/50 text-sm mt-1">
            This is the exact draft-room top band. The cyan <span style={{ color: FOUNDER_CYAN }}>FOUNDER</span> pill
            sits right next to the type word (PRO / HOF / JACKPOT) with a soft cyan glow. Color = {FOUNDER_CYAN}.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Pro draft (Founder)</p>
            <BandRow type="pro" word="PRO" />
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">HOF draft (Founder)</p>
            <BandRow type="hof" word="HOF" />
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Jackpot draft (Founder)</p>
            <BandRow type="jackpot" word="JACKPOT" />
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-white/60 text-sm">
            In the live draft room this band sits at the very top (above the player/turn area), and the
            pill also shows during the filling state. It only appears on Founder drafts — every other
            draft shows just the type word.
          </p>
        </div>
      </div>
    </div>
  );
}
