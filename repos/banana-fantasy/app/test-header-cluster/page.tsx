'use client';

/**
 * Header cluster redesign — preview (TEMP, safe to delete).
 *
 * Mock-ups of the top-right header cluster (batch counter · passes · wheel ·
 * bell · avatar) in a few Apple-style "obsidian" directions. Sample data only,
 * no hooks. Compare and pick — chosen option gets wired into the real Header.
 *
 * Live at /test-header-cluster.
 */

import { useState } from 'react';

// ── Sample data (matches Boris's screenshot) ─────────────────────────────
const DATA = {
  current: 11,
  batchEnd: 100,
  jp: 1,
  hof: 2,
  passes: 1,
  spins: 14,
  notis: 4,
};

// ── Shared glyphs (thin, monochrome line icons — Apple SF-style) ─────────
function TicketGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4z" />
    </svg>
  );
}
function BellGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
function ChevronGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
// Monochrome "spin" glyph — a ring with a notch, reads as a wheel without color.
function SpinGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5l6 4" opacity={0.55} />
    </svg>
  );
}
// 8 spoke endpoints (every 45°, r≈46) — the wheel's segment boundaries.
const SPOKES: [number, number][] = [
  [50, 4], [82.5, 17.5], [96, 50], [82.5, 82.5], [50, 96], [17.5, 82.5], [4, 50], [17.5, 17.5],
];

// VERSION 1 — "Lines only": the wheel drawn purely in lines (outer ring + 8
// spokes + hub), nothing shaded. Reads exactly like the wheel, all line work.
function WheelLines({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <path d="M50,0 L44,11 L56,11 Z" fill="rgba(255,255,255,0.6)" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="3" />
      <g stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round">
        {SPOKES.map(([x, y], i) => <line key={i} x1="50" y1="50" x2={x} y2={y} />)}
      </g>
      <circle cx="50" cy="50" r="11.5" fill="#0c0d11" stroke="rgba(255,255,255,0.6)" strokeWidth="2.6" />
    </svg>
  );
}

// VERSION 2 — "All grey": every segment shaded the same grey, with the 8 spoke
// dividers + hub on top so the wheel structure still reads.
function WheelGrey({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <path d="M50,0 L44,11 L56,11 Z" fill="rgba(255,255,255,0.6)" />
      <circle cx="50" cy="50" r="46" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.5)" strokeWidth="2.6" />
      <g stroke="rgba(255,255,255,0.4)" strokeWidth="1.6" strokeLinecap="round">
        {SPOKES.map(([x, y], i) => <line key={i} x1="50" y1="50" x2={x} y2={y} />)}
      </g>
      <circle cx="50" cy="50" r="11.5" fill="#0c0d11" stroke="rgba(255,255,255,0.5)" strokeWidth="2.2" />
    </svg>
  );
}

// The current colorful wheel (for the "keep as-is" comparison).
function ColorfulWheel({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx="50" cy="50" r="48" fill="#2D3A6D" stroke="#1E2A5E" strokeWidth="2" />
      <path d="M50,50 L50,8 A42,42 0 0,1 79.7,20.3 Z" fill="#F59E0B" />
      <path d="M50,50 L79.7,20.3 A42,42 0 0,1 92,50 Z" fill="#EC4899" />
      <path d="M50,50 L92,50 A42,42 0 0,1 79.7,79.7 Z" fill="#8B5CF6" />
      <path d="M50,50 L79.7,79.7 A42,42 0 0,1 50,92 Z" fill="#F97316" />
      <path d="M50,50 L50,92 A42,42 0 0,1 20.3,79.7 Z" fill="#EF4444" />
      <path d="M50,50 L20.3,79.7 A42,42 0 0,1 8,50 Z" fill="#22C55E" />
      <path d="M50,50 L8,50 A42,42 0 0,1 20.3,20.3 Z" fill="#FBBF24" />
      <path d="M50,50 L20.3,20.3 A42,42 0 0,1 50,8 Z" fill="#06B6D4" />
      <circle cx="50" cy="50" r="14" fill="#1E2A5E" />
    </svg>
  );
}
function Avatar({ size = 34 }: { size?: number }) {
  return (
    <div
      className="rounded-full bg-gradient-to-b from-[#3a3a44] to-[#23232b] flex items-center justify-center text-base"
      style={{ width: size, height: size, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
    >
      🍌
    </div>
  );
}

// Batch counter — kept across all options; JP red / HOF gold are the only
// "loud" colors we keep (Boris: keep the JP & HOF colors).
function Counter({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className={`${compact ? 'text-[13px]' : 'text-[15px]'} font-semibold tabular-nums text-white/80`}>
        {DATA.current}<span className="text-white/35 font-normal">/{DATA.batchEnd}</span>
      </span>
      <div className="flex items-center gap-2 leading-none mt-0.5">
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-bold tabular-nums text-jackpot">{DATA.jp}</span>
          <span className="text-[8.5px] font-semibold tracking-wide text-white/45">JP</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-bold tabular-nums text-hof">{DATA.hof}</span>
          <span className="text-[8.5px] font-semibold tracking-wide text-white/45">HOF</span>
        </span>
      </div>
    </div>
  );
}

const Divider = () => <span className="h-6 w-px bg-white/[0.08]" />;

// Small count badge — single accent (banana). Used for spins.
function CountBadge({ n, tone = 'banana' }: { n: number; tone?: 'banana' | 'dot' }) {
  if (tone === 'dot') {
    return <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-jackpot ring-2 ring-[#0c0d11]" />;
  }
  return (
    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-banana text-black text-[9.5px] font-bold flex items-center justify-center tabular-nums">
      {n}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   OPTION A — "Quiet Obsidian": one subtle container, monochrome line glyphs,
   hairline dividers. Only color = JP/HOF + a single banana count.
   ════════════════════════════════════════════════════════════════════════ */
function OptionA() {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] pl-3 pr-1.5 py-1.5">
      <Counter />
      <Divider />
      {/* passes */}
      <button className="relative flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-white/[0.06] text-white/70">
        <TicketGlyph className="w-[18px] h-[18px]" />
        <span className="text-[12px] font-semibold tabular-nums text-white/85">{DATA.passes}</span>
      </button>
      {/* spins */}
      <button className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/[0.06] text-white/70">
        <SpinGlyph className="w-[19px] h-[19px]" />
        <CountBadge n={DATA.spins} />
      </button>
      {/* bell */}
      <button className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/[0.06] text-white/70">
        <BellGlyph className="w-[18px] h-[18px]" />
        <CountBadge n={DATA.notis} tone="dot" />
      </button>
      <Divider />
      <button className="flex items-center gap-1 pl-0.5 pr-1 py-0.5 rounded-full hover:bg-white/[0.06]">
        <Avatar />
        <ChevronGlyph className="w-3.5 h-3.5 text-white/40" />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   OPTION B — "Stats Capsule": batch + passes + spins fused into ONE capsule
   with internal dividers (like the promos stat row). Bell + avatar separate.
   ════════════════════════════════════════════════════════════════════════ */
function StatCell({ label, value, valueClass = 'text-white/85' }: { label: React.ReactNode; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-3.5 leading-none gap-1">
      <span className={`text-[14px] font-semibold tabular-nums ${valueClass}`}>{value}</span>
      <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-white/40">{label}</span>
    </div>
  );
}
function OptionB() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-2xl bg-white/[0.03] border border-white/[0.06] py-1.5 divide-x divide-white/[0.07]">
        <StatCell label="Batch" value={<>{DATA.current}<span className="text-white/35 font-normal">/{DATA.batchEnd}</span></>} />
        <StatCell label="JP · HOF" value={<span><span className="text-jackpot">{DATA.jp}</span><span className="text-white/25"> · </span><span className="text-hof">{DATA.hof}</span></span>} />
        <StatCell label="Passes" value={DATA.passes} />
        <StatCell label="Spins" value={DATA.spins} valueClass="text-banana" />
      </div>
      <button className="relative flex items-center justify-center w-9 h-9 rounded-full bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-white/70">
        <BellGlyph className="w-[18px] h-[18px]" />
        <CountBadge n={DATA.notis} tone="dot" />
      </button>
      <button className="flex items-center gap-1 pl-0.5 pr-1 py-0.5 rounded-full hover:bg-white/[0.06]">
        <Avatar />
        <ChevronGlyph className="w-3.5 h-3.5 text-white/40" />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   OPTION C — "Spacious Circular": each control is its own 36px circle, airy
   spacing, duotone wheel kept (calmer), dot-style unread. Most "premium".
   ════════════════════════════════════════════════════════════════════════ */
// Bare icon button — no circle background; just a hit area. Icons sit at one
// uniform size. (The avatar keeps its own circle; everything else is bare.)
function CircleBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="relative flex items-center justify-center w-[26px] h-[26px] text-white/75 hover:text-white transition-colors">
      {children}
    </button>
  );
}
type WheelStyle = 'lines' | 'grey' | 'colorful';
function WheelIcon({ wheel, size = 26 }: { wheel: WheelStyle; size?: number }) {
  if (wheel === 'lines') return <WheelLines size={size} />;
  if (wheel === 'grey') return <WheelGrey size={size} />;
  return <ColorfulWheel size={size} />;
}
// Pass with the count INSIDE the ticket (gold), vs a bare ticket + corner badge.
function TicketInside({ n }: { n: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: 34, height: 22 }}>
      <svg viewBox="0 0 24 16" className="w-[34px] h-[22px]" fill="none" stroke="#fbbf24" strokeWidth={1.4} strokeLinejoin="round">
        <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h16a1.5 1.5 0 0 1 1.5 1.5v1.6a1.6 1.6 0 0 0 0 3.2v1.7A1.5 1.5 0 0 1 20 12H4a1.5 1.5 0 0 1-1.5-1.5V8.9a1.6 1.6 0 0 0 0-3.2z" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-banana tabular-nums">{n}</span>
    </span>
  );
}
function OptionC({ wheel = 'lines', passStyle = 'inside' }: { wheel?: WheelStyle; passStyle?: 'inside' | 'badge' }) {
  // Equal breathing room: one consistent gap between every control.
  return (
    <div className="flex items-center gap-4">
      <Counter />
      {passStyle === 'inside' ? (
        <button className="relative flex items-center justify-center hover:opacity-80 transition-opacity"><TicketInside n={DATA.passes} /></button>
      ) : (
        <CircleBtn>
          <TicketGlyph className="w-[22px] h-[22px]" />
          <CountBadge n={DATA.passes} />
        </CircleBtn>
      )}
      <CircleBtn>
        <WheelIcon wheel={wheel} size={22} />
        <CountBadge n={DATA.spins} />
      </CircleBtn>
      <CircleBtn>
        <BellGlyph className="w-[22px] h-[22px]" />
        <CountBadge n={DATA.notis} tone="dot" />
      </CircleBtn>
      <button className="flex items-center gap-1 pl-0.5 pr-1 py-0.5 rounded-full hover:bg-white/[0.06]">
        <Avatar size={36} />
        <ChevronGlyph className="w-3.5 h-3.5 text-white/40" />
      </button>
    </div>
  );
}

/* ── A faux header bar for context (logo + nav on the left) ───────────── */
function HeaderBar({ children, width = '100%' }: { children: React.ReactNode; width?: string }) {
  return (
    <div
      className="mx-auto flex items-center justify-between rounded-2xl border border-white/[0.06] bg-[#0c0d11] px-4 py-2.5"
      style={{ width, maxWidth: '100%' }}
    >
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍌</span>
          <span className="text-white font-bold tracking-tight">SBS</span>
        </div>
        <nav className="hidden sm:flex items-center gap-4 text-[13px] text-white/55">
          <span>Draft</span><span>Teams</span><span>Promos</span>
        </nav>
      </div>
      {children}
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="mb-9">
      <h2 className="text-white text-[15px] font-semibold mb-0.5">{title}</h2>
      <p className="text-white/45 text-[12.5px] mb-3 leading-relaxed">{blurb}</p>
      {children}
    </div>
  );
}

export default function TestHeaderCluster() {
  const [wheel, setWheel] = useState<WheelStyle>('lines');
  const [passStyle, setPassStyle] = useState<'inside' | 'badge'>('inside');
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Header cluster — design options</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-8 leading-relaxed">
          Calmer, more Apple/obsidian. One accent kept for counts (banana), and JP/HOF stay
          red &amp; gold. Sample data: 11/100 · 1 JP · 2 HOF · 1 pass · 14 spins · 4 notis.
        </p>

        <Section
          title="Option C — Spacious Circular  ⭐ (the one you're shipping)"
          blurb="Each control is its own round button with equal breathing room. Two wheel versions below: 'Lines only' (the wheel drawn purely in lines, nothing shaded) and 'All grey' (every segment shaded grey). Toggle to compare — pick one and I'll ship it."
        >
          <HeaderBar><OptionC wheel={wheel} passStyle={passStyle} /></HeaderBar>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-white/40 text-xs mr-1">Pass:</span>
            {(['inside', 'badge'] as const).map(p => (
              <button key={p} onClick={() => setPassStyle(p)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${passStyle === p ? 'bg-banana text-black' : 'bg-white/[0.05] text-white/60 hover:text-white'}`}>
                {p === 'inside' ? 'Number inside pass' : 'Badge on top'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-white/40 text-xs mr-1">Wheel:</span>
            {(['lines', 'grey', 'colorful'] as const).map(w => (
              <button
                key={w}
                onClick={() => setWheel(w)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${wheel === w ? 'bg-banana text-black' : 'bg-white/[0.05] text-white/60 hover:text-white'}`}
              >
                {w === 'lines' ? 'Lines only (no shade)' : w === 'grey' ? 'All grey' : 'Current (colorful)'}
              </button>
            ))}
          </div>
          {/* big side-by-side of just the two wheels so the difference is obvious */}
          <div className="mt-5 flex items-center gap-8">
            <div className="flex flex-col items-center gap-2"><WheelLines size={64} /><span className="text-white/40 text-[11px]">Lines only</span></div>
            <div className="flex flex-col items-center gap-2"><WheelGrey size={64} /><span className="text-white/40 text-[11px]">All grey</span></div>
            <div className="flex flex-col items-center gap-2"><ColorfulWheel size={64} /><span className="text-white/40 text-[11px]">Current</span></div>
          </div>
        </Section>

        <Section
          title="Option C — mobile widths"
          blurb="Same Option C scaled to phone widths with equal spacing. On the smallest screens the bell collapses into the profile menu; counter + passes + wheel + avatar stay one glance away."
        >
          <div className="space-y-4">
            {/* 430px (large phone) — full set */}
            <HeaderBar width="430px">
              <div className="flex items-center gap-3">
                <Counter compact />
                <CircleBtn><TicketGlyph className="w-[20px] h-[20px]" /><CountBadge n={DATA.passes} /></CircleBtn>
                <CircleBtn><WheelIcon wheel={wheel} size={20} /><CountBadge n={DATA.spins} /></CircleBtn>
                <CircleBtn><BellGlyph className="w-[20px] h-[20px]" /><CountBadge n={DATA.notis} tone="dot" /></CircleBtn>
                <Avatar size={32} />
              </div>
            </HeaderBar>
            {/* 360px (small phone) — bell folds away, tighter but still equal gaps */}
            <HeaderBar width="360px">
              <div className="flex items-center gap-2.5">
                <Counter compact />
                <CircleBtn><TicketGlyph className="w-[20px] h-[20px]" /><CountBadge n={DATA.passes} /></CircleBtn>
                <CircleBtn><WheelIcon wheel={wheel} size={20} /><CountBadge n={DATA.spins} /></CircleBtn>
                <Avatar size={30} />
              </div>
            </HeaderBar>
          </div>
        </Section>

        <p className="text-white/30 text-[11px] uppercase tracking-[0.08em] mb-4 mt-2">Other options (for reference)</p>

        <Section
          title="Option A — Quiet Obsidian"
          blurb="Everything in one subtle container with hairline dividers. Monochrome line glyphs; only color is JP/HOF + one banana spin count. Tightest + calmest."
        >
          <HeaderBar><OptionA /></HeaderBar>
        </Section>

        <Section
          title="Option B — Stats Capsule"
          blurb="Batch, JP/HOF, passes and spins fuse into one segmented capsule with little labels. Most informative."
        >
          <HeaderBar><OptionB /></HeaderBar>
        </Section>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Ready to ship Option C</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">
            Just tell me the wheel — <span className="text-white/70">Lines only</span> or <span className="text-white/70">All grey</span> — and I&apos;ll wire Option C into the real header for mobile + desktop. JP/HOF stay red &amp; gold; everything else stays quiet.
          </p>
        </div>
      </div>
    </div>
  );
}
