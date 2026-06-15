'use client';

/**
 * JP / HOF draft-room TOP BAR — redesign preview (TEMP, safe to delete).
 *
 * Inside a live Jackpot/HOF draft the entire top band is currently a big
 * saturated red/gold slab. These are clean "obsidian" takes: the band stays
 * dark, and JP red / HOF gold become a restrained accent (thin line / soft glow
 * / chip + on-clock ring). Toggle the type and compare with the current look.
 *
 * Live at /test-draft-top.
 */

import { useState } from 'react';

type DT = 'jackpot' | 'hof';
const RED = '#ef4444', GOLD = '#D4AF37';
const accentOf = (t: DT) => (t === 'jackpot' ? RED : GOLD);
const meta = (t: DT) => t === 'jackpot'
  ? { word: 'JACKPOT', color: RED, icon: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg> }
  : { word: 'HALL OF FAME', color: GOLD, icon: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round"><path d="M4 18h16M4 18l-1.5-9 5 4 4.5-7 4.5 7 5-4L20 18" /></svg> };

type SlotState = 'you' | 'current' | 'done' | 'idle';
const DRAFTERS: { name: string; state: SlotState; t?: string }[] = [
  { name: 'You', state: 'done' },
  { name: 'Mike', state: 'done' },
  { name: 'Sara', state: 'done' },
  { name: 'Leo', state: 'current', t: '0:42' },
  { name: 'Ava', state: 'idle' },
  { name: 'Kai', state: 'idle' },
  { name: 'Jo', state: 'idle' },
];

function Avatar({ name, ring }: { name: string; ring?: string }) {
  return (
    <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm bg-gradient-to-b from-[#3a3a44] to-[#23232b]"
      style={{ boxShadow: ring ? `0 0 0 2px ${ring}` : 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
      {name === 'You' ? '🍌' : name[0]}
    </div>
  );
}

function PickStrip({ accent, dark = true }: { accent: string; dark?: boolean }) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      {DRAFTERS.map((d, i) => {
        const ring = d.state === 'you' || d.name === 'You' ? '#F3E216' : d.state === 'current' ? accent : undefined;
        return (
          <div key={i} className="flex-shrink-0 w-[92px] rounded-xl px-2 pt-2.5 pb-2 text-center"
            style={{ background: dark ? 'rgba(255,255,255,0.03)' : '#222', border: `1px solid ${d.state === 'current' ? accent + '88' : d.name === 'You' ? 'rgba(243,226,22,0.5)' : 'rgba(255,255,255,0.07)'}` }}>
            <div className="flex justify-center"><Avatar name={d.name} ring={ring} /></div>
            <div className="mt-1.5 text-[12px] font-bold text-white truncate">{d.name}</div>
            <div className="mt-0.5 h-[18px] text-[13px] font-bold tabular-nums" style={{ color: d.state === 'current' ? accent : 'transparent' }}>
              {d.state === 'current' ? d.t : '·'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chip({ t }: { t: DT }) {
  const m = meta(t);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-wide"
      style={{ color: m.color, background: `${m.color}1A`, boxShadow: `inset 0 0 0 1px ${m.color}55` }}>
      {m.icon}{m.word}
    </span>
  );
}

function StatusLine({ color = 'rgba(255,255,255,0.7)' }: { color?: string }) {
  return (
    <div className="text-center text-[13px] font-bold uppercase tracking-wide" style={{ color }}>
      2 turns until your pick! <span className="ml-2 font-medium opacity-60">Pick 24 / 150</span>
    </div>
  );
}

/* ── CURRENT (the big saturated slab, approximated) ── */
function CurrentLook({ t }: { t: DT }) {
  const bg = t === 'jackpot'
    ? 'linear-gradient(180deg,rgba(255,255,255,0.20),rgba(0,0,0,0.20)), radial-gradient(130% 130% at 50% -12%, #E63A40, #C71F29 46%, #8E141C)'
    : 'linear-gradient(180deg,rgba(255,255,255,0.22),rgba(0,0,0,0.18)), linear-gradient(180deg,#F4DC7A,#DCB845 40%,#BE9430 72%,#A37C26)';
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: bg, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.5)' }}>
      <div className="px-4 pt-3 pb-3">
        <PickStrip accent="#fff" dark={false} />
        <div className="mt-3"><StatusLine color={t === 'hof' ? '#231900' : '#fff'} /></div>
      </div>
    </div>
  );
}

/* ── OPTION A — Accent line: obsidian band, thin top accent + chip, on-clock ring ── */
function AccentLine({ t }: { t: DT }) {
  const c = accentOf(t);
  return (
    <div className="rounded-2xl overflow-hidden bg-[#0c0d11] border border-white/[0.06]">
      <div className="h-[3px] w-full" style={{ background: c }} />
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-3">
          <Chip t={t} />
          <span className="text-white/40 text-[12px] tabular-nums">Pick 24 / 150</span>
        </div>
        <PickStrip accent={c} />
        <div className="mt-3"><StatusLine /></div>
      </div>
    </div>
  );
}

/* ── OPTION B — Ambient glow: color bleeds from the top edge then fades to black ── */
function AmbientGlow({ t }: { t: DT }) {
  const c = accentOf(t);
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#0c0d11] border border-white/[0.06]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24" style={{ background: `linear-gradient(180deg, ${c}38, ${c}10 40%, transparent 100%)` }} />
      <div className="relative px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-3">
          <Chip t={t} />
          <span className="text-white/45 text-[12px] tabular-nums">Pick 24 / 150</span>
        </div>
        <PickStrip accent={c} />
        <div className="mt-3"><StatusLine /></div>
      </div>
    </div>
  );
}

/* ── OPTION C — Side rail: a slim colored rail on the left edge only ── */
function SideRail({ t }: { t: DT }) {
  const c = accentOf(t);
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#0c0d11] border border-white/[0.06]">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: c, boxShadow: `0 0 16px ${c}` }} />
      <div className="px-5 pt-3 pb-3">
        <div className="flex items-center justify-between mb-3">
          <Chip t={t} />
          <span className="text-white/40 text-[12px] tabular-nums">Pick 24 / 150</span>
        </div>
        <PickStrip accent={c} />
        <div className="mt-3"><StatusLine /></div>
      </div>
    </div>
  );
}

function Block({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-white text-[15px] font-semibold mb-0.5">{title}</h2>
      <p className="text-white/45 text-[12.5px] mb-3 leading-relaxed max-w-xl">{blurb}</p>
      {children}
    </div>
  );
}

export default function TestDraftTop() {
  const [t, setT] = useState<DT>('jackpot');
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">JP / HOF draft-room top bar</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-5 leading-relaxed">
          Inside a live Jackpot/HOF draft, the whole top is a big saturated slab. These keep the band dark/obsidian and
          use JP red / HOF gold as a restrained accent — premium, not loud. The on-clock player&apos;s ring + timer use the
          accent; &ldquo;you&rdquo; stays the banana ring.
        </p>

        <div className="inline-flex items-center gap-1 mb-8 rounded-full bg-white/[0.05] p-1">
          {(['jackpot', 'hof'] as const).map(x => (
            <button key={x} onClick={() => setT(x)} className="px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
              style={t === x ? { background: accentOf(x), color: x === 'hof' ? '#231900' : '#fff' } : { color: 'rgba(255,255,255,0.55)' }}>
              {x === 'jackpot' ? 'Jackpot' : 'HOF'}
            </button>
          ))}
        </div>

        <Block title="Current (live) — for reference" blurb="The whole band is a saturated red/gold slab.">
          <CurrentLook t={t} />
        </Block>
        <Block title="Option A — Accent line" blurb="Dark obsidian band, a thin accent line on top + a clean type chip. The on-clock card rings in the accent. Most restrained.">
          <AccentLine t={t} />
        </Block>
        <Block title="Option B — Ambient glow" blurb="The accent color bleeds softly from the top edge then fades to black — keeps a rich colored feel without the flat slab.">
          <AmbientGlow t={t} />
        </Block>
        <Block title="Option C — Side rail" blurb="A slim glowing rail on the left edge + chip. Subtle, distinctive, very little color.">
          <SideRail t={t} />
        </Block>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Pick one</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">Tell me A, B, or C and I&apos;ll rebuild the real JP/HOF draft-room top band in that style (it shares the same band code across filling / reveal / drafting, so it stays consistent), keeping all the pick cards, timers, and status logic.</p>
        </div>
      </div>
    </div>
  );
}
