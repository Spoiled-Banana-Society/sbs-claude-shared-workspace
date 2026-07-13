'use client';

/**
 * TEMP preview (Boris 2026-06-11) — options for promo cards whose middle is
 * blank now that binary 0/1 bars are gone. Three treatments of the same
 * three cards, real card dimensions/colors. Delete when decided.
 *
 * Pick 10 = you landed slot 10 (last pick) in a draft → Free Spin.
 */

import React from 'react';

function Card({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[20px] p-5 w-52 h-56 flex-shrink-0 bg-[#fbfbfd] flex flex-col">
      <h3 className="text-xl font-bold text-[#1d1d1f] text-center">{title}</h3>
      <p className="text-center text-[#1d1d1f] font-semibold mt-1 text-sm">→ FREE SPIN</p>
      {children}
    </div>
  );
}

function Row({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-white font-bold">{label}</h2>
        <p className="text-text-muted text-xs">{note}</p>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}

export default function TestPromoCardsPage() {
  return (
    <div className="min-h-screen bg-bg-primary px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-10">
        <header>
          <h1 className="text-white font-bold text-xl">Promo card options — blank middles</h1>
          <p className="text-text-secondary text-sm mt-1">Same three cards, three treatments. All data shown would be real + live.</p>
        </header>

        <Row label="Option A — as is" note="Clean blank middle, Learn more on hover. Baseline.">
          <Card title="Jackpot Hit" />
          <Card title="Refer Friend" />
          <Card title="Pick 10" />
        </Row>

        <Row label="Option B — one quiet live line" note="A single muted stat anchored low, where the bar used to sit. Updates realtime.">
          <Card title="Jackpot Hit">
            <div className="mt-auto text-center">
              <p className="text-xs text-[#6e6e73] font-medium">Draft #83 of 100</p>
            </div>
          </Card>
          <Card title="Refer Friend">
            <div className="mt-auto text-center">
              <p className="text-xs text-[#6e6e73] font-medium">2 friends joined · 1 Spin earned</p>
            </div>
          </Card>
          <Card title="Pick 10">
            <div className="mt-auto text-center">
              <p className="text-xs text-[#6e6e73] font-medium">2 Pick-10 slots landed</p>
            </div>
          </Card>
        </Row>

        <Row label="Option C — big quiet number" note="Apple-stat style: one large light number centered in the blank space, tiny label under it.">
          <Card title="Jackpot Hit">
            <div className="flex-1 flex flex-col items-center justify-center -mt-2">
              <p className="text-4xl font-light text-[#1d1d1f] tracking-tight">#83<span className="text-xl text-[#9a9a9a]">/100</span></p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">current cycle</p>
            </div>
          </Card>
          <Card title="Refer Friend">
            <div className="flex-1 flex flex-col items-center justify-center -mt-2">
              <p className="text-4xl font-light text-[#1d1d1f] tracking-tight">2</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">friends joined</p>
            </div>
          </Card>
          <Card title="Pick 10">
            <div className="flex-1 flex flex-col items-center justify-center -mt-2">
              <p className="text-4xl font-light text-[#1d1d1f] tracking-tight">2</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">Pick-10 slots landed</p>
            </div>
          </Card>
        </Row>

        <footer className="text-text-muted text-[11px] border-t border-white/10 pt-4">
          B keeps the layout identical to today (safest). C fills the space with one
          confident number but changes the card&apos;s feel. Mix is possible: C for stats-y
          promos (Jackpot cycle), A for ones with nothing worth counting.
        </footer>
      </div>
    </div>
  );
}
