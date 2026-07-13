'use client';

/**
 * Draft-type reveal (slot machine) — redesign preview (TEMP, safe to delete).
 *
 * The current reveal is purple-gradient reels + emoji + neon text. These are
 * clean "obsidian" takes in the same language as everything else: monochrome
 * reels, thin line icons, JP red / HOF gold as restrained accents, a smooth
 * settle, and a calm result card. Hit Spin to watch it.
 *
 * Live at /test-slot-machine.
 */

import { useState, useRef, useCallback } from 'react';

type T = 'jackpot' | 'hof' | 'pro';

const META: Record<T, { word: string; label: string; color: string; perk: string; icon: (c?: string) => React.ReactNode }> = {
  jackpot: { word: 'Jackpot', label: 'JACKPOT', color: '#ef4444', perk: 'Win your league — skip straight to the Finals.', icon: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg> },
  hof: { word: 'Hall of Fame', label: 'HALL OF FAME', color: '#D4AF37', perk: 'Compete for a bonus prize pool on top of the tournament.', icon: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round"><path d="M4 18h16M4 18l-1.5-9 5 4 4.5-7 4.5 7 5-4L20 18" /></svg> },
  pro: { word: 'Pro', label: 'PRO', color: '#cbd5e1', perk: 'The standard draft — compete for the prize pool.', icon: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5" /></svg> },
};

const ITEM_H = 116;
const REEL_LEN = 32;
const LAND = REEL_LEN - 3;            // landing index near the end
const TRAVEL = LAND * ITEM_H;          // px the reel scrolls

function randType(): T {
  const r = Math.random();
  return r < 0.06 ? 'jackpot' : r < 0.2 ? 'hof' : 'pro';
}
function buildReel(result: T): T[] {
  const arr = Array.from({ length: REEL_LEN }, randType);
  arr[LAND] = result;
  return arr;
}

function ReelItem({ t, dim }: { t: T; dim?: boolean }) {
  const m = META[t];
  return (
    <div className="flex flex-col items-center justify-center gap-1.5" style={{ height: ITEM_H }}>
      <span className="w-7 h-7" style={{ color: m.color, opacity: dim ? 0.45 : 1 }}>{m.icon('w-7 h-7')}</span>
      <span className="text-[11px] font-bold tracking-[0.12em]" style={{ color: m.color, opacity: dim ? 0.4 : 0.9 }}>{m.label}</span>
    </div>
  );
}

/* OPTION 1 — clean 3-reel slot */
function ThreeReel({ result, runId, onDone, landed }: { result: T; runId: number; onDone: () => void; landed: boolean }) {
  const reels = [buildReel(result), buildReel(result), buildReel(result)];
  const durations = [2.0, 2.45, 2.9];
  return (
    <div className="mx-auto w-fit rounded-3xl border border-white/[0.07] bg-[#0e0f14] p-4 shadow-2xl shadow-black/50">
      <div className="relative flex gap-2.5">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 z-20 rounded-xl"
          style={{ height: ITEM_H, border: `1px solid ${landed ? META[result].color + '88' : 'rgba(255,255,255,0.12)'}`, background: landed ? META[result].color + '12' : 'rgba(255,255,255,0.02)', transition: 'border-color .4s, background .4s' }} />
        {reels.map((items, ri) => (
          <div key={ri} className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]" style={{ width: 116, height: ITEM_H * 3 }}>
            <div
              key={runId}
              className="absolute left-0 right-0"
              style={{ top: ITEM_H, transform: `translateY(-${TRAVEL}px)`, animation: `slotSpin ${durations[ri]}s cubic-bezier(0.16,1,0.3,1) forwards` }}
              onAnimationEnd={ri === 2 ? onDone : undefined}
            >
              {items.map((t, i) => <ReelItem key={i} t={t} dim={landed && i !== LAND} />)}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-10 z-10" style={{ background: 'linear-gradient(180deg,#0e0f14,transparent)' }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 z-10" style={{ background: 'linear-gradient(0deg,#0e0f14,transparent)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* OPTION 2 — single elegant column */
function SingleColumn({ result, runId, onDone, landed }: { result: T; runId: number; onDone: () => void; landed: boolean }) {
  const items = buildReel(result);
  return (
    <div className="mx-auto w-fit rounded-3xl border border-white/[0.07] bg-[#0e0f14] px-10 py-4 shadow-2xl shadow-black/50">
      <div className="relative overflow-hidden" style={{ width: 220, height: ITEM_H * 3 }}>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 z-20 rounded-xl"
          style={{ height: ITEM_H, border: `1px solid ${landed ? META[result].color + '88' : 'rgba(255,255,255,0.1)'}`, background: landed ? META[result].color + '10' : 'transparent', transition: 'border-color .4s, background .4s' }} />
        <div key={runId} className="absolute left-0 right-0" style={{ top: ITEM_H, transform: `translateY(-${TRAVEL}px)`, animation: `slotSpin 2.6s cubic-bezier(0.16,1,0.3,1) forwards` }} onAnimationEnd={onDone}>
          {items.map((t, i) => <ReelItem key={i} t={t} dim={landed && i !== LAND} />)}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 z-10" style={{ background: 'linear-gradient(180deg,#0e0f14,transparent)' }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 z-10" style={{ background: 'linear-gradient(0deg,#0e0f14,transparent)' }} />
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: T }) {
  const m = META[result];
  return (
    <div className="mt-6 text-center" style={{ animation: 'fadeUp .5s ease-out' }}>
      <div className="inline-flex items-center gap-2.5">
        <span className="w-6 h-6" style={{ color: m.color }}>{m.icon('w-6 h-6')}</span>
        <span className="text-2xl font-bold tracking-tight" style={{ color: m.color }}>{m.label}</span>
      </div>
      <p className="text-white/55 text-[13px] mt-2 max-w-xs mx-auto leading-relaxed">{m.perk}</p>
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        Provably fair · Chainlink VRF
      </div>
    </div>
  );
}

function Stage({ variant }: { variant: 'three' | 'single' }) {
  const [result, setResult] = useState<T>('hof');
  const [runId, setRunId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false);
  const forced = useRef<T | 'random'>('random');

  const spin = useCallback(() => {
    const next = forced.current === 'random' ? randType() : forced.current;
    setResult(next);
    setLanded(false);
    setSpinning(true);
    setRunId(r => r + 1);
  }, []);
  const onDone = useCallback(() => { setSpinning(false); setLanded(true); }, []);

  return (
    <div>
      {variant === 'three'
        ? <ThreeReel result={result} runId={runId} onDone={onDone} landed={landed} />
        : <SingleColumn result={result} runId={runId} onDone={onDone} landed={landed} />}

      <div style={{ minHeight: 118 }}>{landed && <ResultCard result={result} />}</div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button onClick={spin} disabled={spinning} className="px-5 py-2 rounded-xl bg-banana text-black text-[13px] font-bold disabled:opacity-50 hover:brightness-110 transition">
          {spinning ? 'Spinning…' : '↻ Spin'}
        </button>
        <span className="text-white/30 text-xs mx-1">Force:</span>
        {(['random', 'pro', 'hof', 'jackpot'] as const).map(f => (
          <button key={f} onClick={() => { forced.current = f; }} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] text-white/55 hover:text-white transition">
            {f === 'random' ? 'Random' : META[f as T].word}
          </button>
        ))}
      </div>
      <p className="text-white/25 text-[11px] text-center mt-2">Set a force, then Spin to see that outcome.</p>
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-white text-[16px] font-semibold mb-0.5">{title}</h2>
      <p className="text-white/45 text-[12.5px] mb-6 leading-relaxed max-w-lg">{blurb}</p>
      {children}
    </div>
  );
}

export default function TestSlotMachine() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Draft-type reveal — clean rebuild</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-10 leading-relaxed">
          Same obsidian language as everything else: monochrome reels, thin line icons (Jackpot ⚡ · HOF 👑 · Pro ◈),
          a smooth ease-out settle, and a calm result card with the VRF proof. JP red / HOF gold are the only colors,
          and only on the win. Hit Spin.
        </p>

        <Section title="Option 1 — Clean 3-reel slot" blurb="Keeps the slot-machine feel (three reels, staggered stop) but obsidian + monochrome. The center band lights up in the winning color as it lands.">
          <Stage variant="three" />
        </Section>

        <Section title="Option 2 — Single elegant column" blurb="The most minimal / Apple take — one column scrolls through the types and settles. Less casino, more premium reveal.">
          <Stage variant="single" />
        </Section>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">Pick one</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">Tell me Option 1 or 2 (and any tweaks to speed / icons / sound) and I&apos;ll rebuild the real reveal (SlotMachineOverlay) in this style — keeping the live countdown, VRF verification, and the existing draft-room timing intact.</p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes slotSpin { from { transform: translateY(0); } to { transform: translateY(-${TRAVEL}px); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
