'use client';

/**
 * Batch counter "heating up" — preview (TEMP, safe to delete).
 *
 * Option 1 (Halo + "left" pill) is the chosen direction. The heat COLOR now
 * follows what's still unclaimed: red if only Jackpot is left, gold if only
 * HOF, a clean red→gold blend when both are still live. The fire emoji is
 * replaced with our own clean bolt glyph (tintable / gradient).
 *
 * Live at /test-counter-heat.
 */

import { useState, useEffect, useRef } from 'react';

const BATCH_END = 100;
const HOT_WINDOW = 20;
const JP_RED = '#ef4444';
const HOF_GOLD = '#D4AF37';

function heatOf(draftsLeft: number, jp: number, hof: number) {
  if (jp <= 0 && hof <= 0) return 0;
  if (draftsLeft > HOT_WINDOW) return 0;
  return Math.min(1, Math.max(0, (HOT_WINDOW - draftsLeft) / HOT_WINDOW));
}
// Accent driven by which special(s) remain.
function accentFor(jp: number, hof: number) {
  const j = jp > 0, h = hof > 0;
  if (j && h) return { kind: 'mix' as const, a: JP_RED, b: HOF_GOLD };
  if (j) return { kind: 'jp' as const, a: JP_RED, b: JP_RED };
  if (h) return { kind: 'hof' as const, a: HOF_GOLD, b: HOF_GOLD };
  return null;
}

// Our own bolt glyph (replaces the 🔥 emoji). Solid for single color, gradient
// red→gold for the mixed state.
function BoltIcon({ a, b, size = 12 }: { a: string; b: string; size?: number }) {
  const mix = a !== b;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {mix && (
        <defs>
          <linearGradient id="heatBolt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={a} /><stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
      )}
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill={mix ? 'url(#heatBolt)' : a} />
    </svg>
  );
}

function RawCounter({ draftsLeft, jp, hof }: { draftsLeft: number; jp: number; hof: number }) {
  const current = BATCH_END - draftsLeft;
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[16px] font-semibold tabular-nums text-white/80">{current}<span className="text-white/35 font-normal">/{BATCH_END}</span></span>
      <div className="flex items-center gap-2 leading-none mt-0.5">
        <span className="flex items-center gap-1"><span className={`text-[12px] font-bold tabular-nums ${jp > 0 ? '' : 'text-green-400'}`} style={jp > 0 ? { color: JP_RED } : undefined}>{jp > 0 ? jp : '✓'}</span><span className="text-[9px] font-semibold text-white/45">JP</span></span>
        <span className="flex items-center gap-1"><span className={`text-[12px] font-bold tabular-nums ${hof > 0 ? '' : 'text-green-400'}`} style={hof > 0 ? { color: HOF_GOLD } : undefined}>{hof > 0 ? hof : '✓'}</span><span className="text-[9px] font-semibold text-white/45">HOF</span></span>
      </div>
    </div>
  );
}

/* OPTION 1 — Halo + "left" pill (CHOSEN). Color follows what's still live. */
function Opt1({ draftsLeft, jp, hof }: { draftsLeft: number; jp: number; hof: number }) {
  const heat = heatOf(draftsLeft, jp, hof);
  const acc = accentFor(jp, hof);
  const hot = heat > 0 && acc;
  // halo background: single = one radial; mix = red on the left, gold on the right.
  const haloBg = !acc ? undefined
    : acc.kind === 'mix'
      ? `radial-gradient(circle at 28% 50%, ${acc.a}${Math.round((0.10 + heat * 0.26) * 255).toString(16).padStart(2, '0')}, transparent 60%), radial-gradient(circle at 72% 50%, ${acc.b}${Math.round((0.10 + heat * 0.26) * 255).toString(16).padStart(2, '0')}, transparent 60%)`
      : `radial-gradient(circle at 50% 50%, ${acc.a}${Math.round((0.12 + heat * 0.28) * 255).toString(16).padStart(2, '0')}, transparent 65%)`;
  const haloShadow = !acc ? undefined
    : acc.kind === 'mix'
      ? `-6px 0 ${10 + heat * 22}px ${heat * 3}px ${acc.a}66, 6px 0 ${10 + heat * 22}px ${heat * 3}px ${acc.b}66`
      : `0 0 ${10 + heat * 26}px ${heat * 5}px ${acc.a}55`;

  return (
    <div className="relative flex items-center gap-2.5 px-3 py-1.5">
      {hot && <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: haloBg, boxShadow: haloShadow }} />}
      <div className="relative"><RawCounter draftsLeft={draftsLeft} jp={jp} hof={hof} /></div>
      {hot && acc && (
        acc.kind === 'mix' ? (
          // gradient-bordered pill + gradient text for the JP+HOF blend
          <span className="relative inline-block rounded-full p-px" style={{ background: `linear-gradient(90deg, ${acc.a}, ${acc.b})`, animation: `heatPulse ${1.3 - heat}s ease-in-out infinite` }}>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: '#0c0d11' }}>
              <BoltIcon a={acc.a} b={acc.b} />
              <span style={{ backgroundImage: `linear-gradient(90deg, ${acc.a}, ${acc.b})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{draftsLeft} left</span>
            </span>
          </span>
        ) : (
          <span className="relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ color: acc.a, borderColor: `${acc.a}66`, background: `${acc.a}1A`, animation: `heatPulse ${1.3 - heat}s ease-in-out infinite` }}>
            <BoltIcon a={acc.a} b={acc.b} />{draftsLeft} left
          </span>
        )
      )}
    </div>
  );
}

function HeaderBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-[#0c0d11] px-4 py-3">
      <div className="flex items-center gap-2"><span className="text-lg">🍌</span><span className="text-white font-bold tracking-tight">SBS</span></div>
      {children}
    </div>
  );
}
function Card({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="mb-7 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h2 className="text-white text-[15px] font-semibold">{title}</h2>
      <p className="text-white/45 text-[12.5px] mt-0.5 mb-4 leading-relaxed">{blurb}</p>
      <HeaderBar>{children}</HeaderBar>
    </div>
  );
}

export default function TestCounterHeat() {
  const [draftsLeft, setDraftsLeft] = useState(12);
  const [jp, setJp] = useState(1);
  const [hof, setHof] = useState(2);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setDraftsLeft(d => (d <= 1 ? 22 : d - 1)), 1100);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing]);

  const acc = accentFor(jp, hof);
  const heat = heatOf(draftsLeft, jp, hof);
  const state = !acc ? 'No specials left' : draftsLeft > HOT_WINDOW ? 'Cold (normal)' : heat > 0.6 ? 'Critical' : 'Heating up';
  const stateColor = !acc ? 'rgba(255,255,255,0.4)' : acc.kind === 'mix' ? HOF_GOLD : acc.a;

  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Counter — &ldquo;heating up&rdquo; (Option 1)</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-6 leading-relaxed">
          The heat color now follows what&apos;s still unclaimed — <span style={{ color: JP_RED }}>red for Jackpot</span>,
          <span style={{ color: HOF_GOLD }}> gold for HOF</span>, and a clean <span style={{ color: JP_RED }}>red</span>→<span style={{ color: HOF_GOLD }}>gold</span> blend
          when both are live. The fire emoji is now our own bolt glyph. Scrub / Play, and flip JP / HOF to see each color.
        </p>

        {/* controls */}
        <div className="mb-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white/70 text-[13px] font-medium">Drafts left: <span className="text-white font-bold tabular-nums">{draftsLeft}</span></span>
            <span className="text-[12px] font-semibold" style={{ color: stateColor }}>{state}</span>
          </div>
          <input type="range" min={0} max={30} value={draftsLeft} onChange={e => { setPlaying(false); setDraftsLeft(Number(e.target.value)); }} className="w-full accent-banana" />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button onClick={() => setPlaying(p => !p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${playing ? 'bg-jackpot text-white' : 'bg-banana text-black'}`}>{playing ? '■ Stop' : '▶ Simulate live'}</button>
            <span className="text-white/30 text-xs mx-1">Still live:</span>
            <button onClick={() => setJp(v => (v > 0 ? 0 : 1))} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: jp > 0 ? JP_RED : 'rgba(255,255,255,0.4)', background: jp > 0 ? `${JP_RED}1A` : 'rgba(255,255,255,0.05)', boxShadow: jp > 0 ? `inset 0 0 0 1px ${JP_RED}55` : undefined }}>Jackpot {jp > 0 ? 'on' : 'off'}</button>
            <button onClick={() => setHof(v => (v > 0 ? 0 : 2))} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: hof > 0 ? HOF_GOLD : 'rgba(255,255,255,0.4)', background: hof > 0 ? `${HOF_GOLD}1A` : 'rgba(255,255,255,0.05)', boxShadow: hof > 0 ? `inset 0 0 0 1px ${HOF_GOLD}55` : undefined }}>HOF {hof > 0 ? 'on' : 'off'}</button>
          </div>
        </div>

        <Card title="Option 1 — Halo + “left” pill" blurb="Halo + pill recolor to whatever's still live. Try JP-only (red), HOF-only (gold), and both (red→gold blend). The bolt + pill pulse faster as it closes.">
          <Opt1 draftsLeft={draftsLeft} jp={jp} hof={hof} />
        </Card>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Looks good?</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">When wired in, this reads the live batch poll (draftsLeft = batchEnd − filled) and the real remaining JP/HOF, so the color is automatic. Tell me if the bolt works or you want a different mark (arrow / spark / target), then I&apos;ll ship it to the header counter for mobile + desktop.</p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes heatPulse { 0%,100% { transform: scale(1); opacity: 0.92; } 50% { transform: scale(1.06); opacity: 1; } }
      `}</style>
    </div>
  );
}
