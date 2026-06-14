'use client';

/**
 * Batch counter "heating up" — preview (TEMP, safe to delete).
 *
 * Idea: in the last 20 drafts of a batch, if a Jackpot and/or HOF is STILL
 * unclaimed, the odds of the next drafts hitting one climb fast. We want the
 * 11/100 · JP/HOF counter to visibly "heat up" as that window closes, so users
 * know NOW is the moment to draft. Everything here is driven live by a single
 * `draftsLeft` value (scrub it or hit Play) so each option animates in real time.
 *
 * Live at /test-counter-heat.
 */

import { useState, useEffect, useRef } from 'react';

const BATCH_END = 100;
const HOT_WINDOW = 20; // heat starts when <= 20 left
const JP = 1;
const HOF = 2;

// 0 (cold) → 1 (critical). Only heats while a special is still unclaimed.
function heatOf(draftsLeft: number) {
  if (JP <= 0 && HOF <= 0) return 0;
  if (draftsLeft > HOT_WINDOW) return 0;
  return Math.min(1, Math.max(0, (HOT_WINDOW - draftsLeft) / HOT_WINDOW));
}

// The base counter (matches the new header language).
function RawCounter({ draftsLeft }: { draftsLeft: number }) {
  const current = BATCH_END - draftsLeft;
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[16px] font-semibold tabular-nums text-white/80">
        {current}<span className="text-white/35 font-normal">/{BATCH_END}</span>
      </span>
      <div className="flex items-center gap-2 leading-none mt-0.5">
        <span className="flex items-center gap-1"><span className="text-[12px] font-bold tabular-nums text-jackpot">{JP}</span><span className="text-[9px] font-semibold text-white/45">JP</span></span>
        <span className="flex items-center gap-1"><span className="text-[12px] font-bold tabular-nums text-hof">{HOF}</span><span className="text-[9px] font-semibold text-white/45">HOF</span></span>
      </div>
    </div>
  );
}

/* OPTION 1 — Halo + "left" pill: a soft red/gold halo behind the counter grows
   with heat; a small "{n} left" pill fades in and pulses faster as it closes. */
function Opt1({ draftsLeft }: { draftsLeft: number }) {
  const heat = heatOf(draftsLeft);
  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5">
      {heat > 0 && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `0 0 ${10 + heat * 26}px ${heat * 6}px rgba(239,68,68,${0.10 + heat * 0.28})`, background: `radial-gradient(circle at 30% 50%, rgba(212,175,55,${heat * 0.10}), transparent 70%)` }} />
      )}
      <div className="relative"><RawCounter draftsLeft={draftsLeft} /></div>
      {heat > 0 && (
        <span
          className="relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold"
          style={{ color: heat > 0.6 ? '#ef4444' : '#D4AF37', borderColor: heat > 0.6 ? 'rgba(239,68,68,0.4)' : 'rgba(212,175,55,0.4)', background: heat > 0.6 ? 'rgba(239,68,68,0.10)' : 'rgba(212,175,55,0.10)', animation: `heatPulse ${1.3 - heat}s ease-in-out infinite` }}
        >
          🔥 {draftsLeft} left
        </span>
      )}
    </div>
  );
}

/* OPTION 2 — Progress ring: a thin ring wraps the counter, filling as the batch
   completes. Neutral → gold → red as it enters the hot window; pulses when hot. */
function Opt2({ draftsLeft }: { draftsLeft: number }) {
  const heat = heatOf(draftsLeft);
  const pct = ((BATCH_END - draftsLeft) / BATCH_END) * 100;
  const r = 30, c = 2 * Math.PI * r;
  const color = heat === 0 ? 'rgba(255,255,255,0.25)' : heat > 0.6 ? '#ef4444' : '#D4AF37';
  return (
    <div className="relative w-[78px] h-[78px] flex items-center justify-center" style={heat > 0.5 ? { animation: `heatPulse ${1.4 - heat}s ease-in-out infinite` } : undefined}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease', filter: heat > 0 ? `drop-shadow(0 0 ${heat * 5}px ${color})` : undefined }} />
      </svg>
      <RawCounter draftsLeft={draftsLeft} />
    </div>
  );
}

/* OPTION 3 — Ember shimmer: a subtle animated gradient sweeps behind the counter
   only when hot; the JP/HOF numbers glow. Calmest "alive" feel. */
function Opt3({ draftsLeft }: { draftsLeft: number }) {
  const heat = heatOf(draftsLeft);
  return (
    <div className="relative overflow-hidden rounded-2xl border px-3.5 py-2" style={{ borderColor: heat > 0 ? `rgba(239,68,68,${0.12 + heat * 0.25})` : 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
      {heat > 0 && (
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(110deg, transparent 30%, rgba(239,68,68,0.16) 50%, rgba(212,175,55,0.10) 60%, transparent 70%)', backgroundSize: '200% 100%', animation: `emberSweep ${2.6 - heat * 1.4}s linear infinite`, opacity: 0.4 + heat * 0.6 }} />
      )}
      <div className="relative">
        <RawCounter draftsLeft={draftsLeft} />
      </div>
    </div>
  );
}

/* OPTION 4 — Flip ticker + flame: the "drafts left" number sits beside the
   counter and flips on each tick; a flame badge intensifies. Most explicit. */
function Opt4({ draftsLeft }: { draftsLeft: number }) {
  const heat = heatOf(draftsLeft);
  return (
    <div className="flex items-center gap-3">
      <RawCounter draftsLeft={draftsLeft} />
      {heat > 0 ? (
        <div className="flex flex-col items-center leading-none rounded-xl px-2.5 py-1.5 border" style={{ borderColor: heat > 0.6 ? 'rgba(239,68,68,0.45)' : 'rgba(212,175,55,0.4)', background: heat > 0.6 ? 'rgba(239,68,68,0.10)' : 'rgba(212,175,55,0.08)', animation: heat > 0.6 ? `heatPulse ${1.3 - heat}s ease-in-out infinite` : undefined }}>
          <span key={draftsLeft} className="text-[16px] font-bold tabular-nums" style={{ color: heat > 0.6 ? '#ef4444' : '#D4AF37', animation: 'flipIn 0.35s ease-out' }}>{draftsLeft}</span>
          <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: heat > 0.6 ? 'rgba(239,68,68,0.8)' : 'rgba(212,175,55,0.8)' }}>left 🔥</span>
        </div>
      ) : (
        <span className="text-white/30 text-[11px]">{draftsLeft} left this batch</span>
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
  const [draftsLeft, setDraftsLeft] = useState(14);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setDraftsLeft(d => (d <= 1 ? 24 : d - 1));
    }, 1100);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing]);

  const heat = heatOf(draftsLeft);
  const state = draftsLeft > HOT_WINDOW ? 'Cold (normal)' : heat > 0.6 ? 'Critical' : 'Heating up';

  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Counter — &ldquo;heating up&rdquo; in the final drafts</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-6 leading-relaxed">
          While a Jackpot/HOF is still unclaimed and the batch is in its last {HOT_WINDOW} drafts, the counter heats up
          — the closer it gets, the louder it glows — so users know the odds are climbing and it&apos;s time to draft.
          All four react live to the same number. JP red / HOF gold kept; nothing else added.
        </p>

        {/* Live control */}
        <div className="mb-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white/70 text-[13px] font-medium">Drafts left this batch: <span className="text-white font-bold tabular-nums">{draftsLeft}</span></span>
            <span className="text-[12px] font-semibold" style={{ color: state === 'Critical' ? '#ef4444' : state === 'Heating up' ? '#D4AF37' : 'rgba(255,255,255,0.4)' }}>{state}</span>
          </div>
          <input type="range" min={0} max={30} value={draftsLeft} onChange={e => { setPlaying(false); setDraftsLeft(Number(e.target.value)); }} className="w-full accent-banana" />
          <div className="flex items-center justify-between mt-2">
            <span className="text-white/30 text-[11px]">← critical · cold →</span>
            <button onClick={() => setPlaying(p => !p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${playing ? 'bg-jackpot text-white' : 'bg-banana text-black'}`}>{playing ? '■ Stop live' : '▶ Simulate live countdown'}</button>
          </div>
        </div>

        <Card title="Option 1 — Halo + “left” pill" blurb="A soft red/gold halo grows behind the counter; a small “🔥 N left” pill fades in and pulses faster as it closes. Reads instantly, low clutter."><Opt1 draftsLeft={draftsLeft} /></Card>
        <Card title="Option 2 — Progress ring" blurb="A thin ring wraps the counter and fills as the batch completes — neutral → gold → red in the hot window, with a gentle pulse. Most elegant / Apple-watch-like."><Opt2 draftsLeft={draftsLeft} /></Card>
        <Card title="Option 3 — Ember shimmer" blurb="A subtle gradient sweep glows behind the counter only when hot; the border warms up. Calmest “alive” feel, no extra text."><Opt3 draftsLeft={draftsLeft} /></Card>
        <Card title="Option 4 — Flip ticker + flame" blurb="The “drafts left” number sits beside the counter and flips on each tick, with an intensifying flame badge. Most explicit / urgent."><Opt4 draftsLeft={draftsLeft} /></Card>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Pick one (or mix)</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">When wired in, this is driven by the real batch poll (draftsLeft = batchEnd − filled) and only fires when a JP/HOF is still unclaimed — fully live. Tell me which option and I&apos;ll build it into the real header counter.</p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes heatPulse { 0%,100% { transform: scale(1); opacity: 0.92; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes emberSweep { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes flipIn { 0% { transform: translateY(-60%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
}
