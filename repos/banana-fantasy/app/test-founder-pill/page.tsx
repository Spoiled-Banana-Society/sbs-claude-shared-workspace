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
  founderWordColor,
} from '@/lib/draftBandStyle';

function FounderPillMock({ type }: { type: 'pro' | 'hof' | 'jackpot' }) {
  // Identical to the real FounderPill (size="md"): plain word, no background,
  // no border (circle), no glow — SAME color as the band's type word.
  return (
    <span
      className="text-[13px] font-bold uppercase tracking-wider"
      style={{ color: founderWordColor(type), textShadow: draftWordShadow(type) }}
    >
      Founder
    </span>
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
      <FounderPillMock type={type} />
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
            This is the exact draft-room top band. The FOUNDER word sits right next to the type word
            (PRO / HOF / JACKPOT) — plain text, no circle, no glow, in the SAME color as the type word
            (so it reads as one unit): white on JACKPOT, dark on HOF, purple on PRO.
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
            In the live draft room this band sits at the very top (above the player/turn area). The FOUNDER
            word is HIDDEN during filling — it only appears once the draft has FILLED, so players can&apos;t
            know it&apos;s a founder draft beforehand. Only on Founder drafts — every other draft shows just
            the type word.
          </p>
        </div>
      </div>
    </div>
  );
}
