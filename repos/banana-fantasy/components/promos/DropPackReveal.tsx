'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

/**
 * THE DROP pack reveal.
 *
 * ⚠️ This is the pack design from the "SBS Banana Packs" concept mockup, not a
 * new one. Dark charcoal pack, striped foil crimp across the top, the gold
 * BANANA PACK band on the diagonal, "1 PRIZE INSIDE". An earlier version of
 * this file invented a flat yellow pack and it looked nothing like the concept
 * (Richard 2026-08-02).
 *
 * The mechanic that makes it work is the TEASE: when the crimp tears away it
 * exposes a colored strip whose colour tells you the TIER — never the prize.
 *
 *   • a common pull resolves on its own in about a second: rip, flip, done
 *   • gold or flame and the card STOPS face-down, trembling, and waits for YOU
 *     to flip it
 *
 * The pause itself is the tell that you hit something. That's the whole idea,
 * and it's why an empty pack must never get the same ceremony as a seat.
 */

export type RevealPrize =
  | { kind: 'jackpot' }
  | { kind: 'jackhof' }
  | { kind: 'hof' }
  | { kind: 'spins'; spins: number }
  | { kind: 'none' };

type Phase = 'sealed' | 'torn' | 'flipped';

/**
 * Card colours per prize, used only AFTER the flip.
 *
 * ⚠️ The pre-flip TEASE is deliberately NOT one of these. In the original
 * mockup a gold tear meant "10 drafts, 20 drafts, Jackpot or HOF" — four
 * possibilities, so it narrowed things without giving the prize away. Here each
 * colour maps to exactly one prize, so a coloured tear would announce the
 * JackHOF before the card ever turned over and make the flip pointless
 * (Richard 2026-08-02). See TEASE below.
 */
const TIER = {
  none: { edge: '#94a3b8', top: '#272b31' },
  spins: { edge: '#22c55e', top: '#12351f' },
  hof: { edge: '#d4af37', top: '#3a2f10' },
  jackhof: { edge: '#ef6c37', top: '#3c1f0e' },
  jackpot: { edge: '#ef4444', top: '#3c0e0e' },
} as const;

/**
 * What shows in the tear, and on the back of the face-down card. BINARY: you
 * learn THAT you won, never WHAT. Every win looks identical until you flip it,
 * so a 1-spin and a JackHOF are indistinguishable right up to the reveal.
 */
const TEASE = { win: '#fbbf24', none: '#3a3a46' } as const;

// ── Sound. Synthesised: no assets, and every level is a GainNode, which iOS
//    honours where it ignores el.volume. ──
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const C = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(f: number, dur: number, gain: number, type: OscillatorType = 'triangle', at = 0) {
  const c = audio(); if (!c || c.state !== 'running') return;
  const t = c.currentTime + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
}
function rip() {
  const c = audio(); if (!c || c.state !== 'running') return;
  const t = c.currentTime, d = 0.34;
  const n = Math.floor(c.sampleRate * d);
  const b = c.createBuffer(1, n, c.sampleRate);
  const ch = b.getChannelData(0);
  for (let i = 0; i < n; i += 1) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 0.6;
  const src = c.createBufferSource(); src.buffer = b;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + d);
  bp.Q.value = 0.8;
  const g = c.createGain(); g.gain.setValueAtTime(0.20, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(bp).connect(g).connect(c.destination); src.start(t); src.stop(t + d);
}
/** Tension bed while a big card sits face-down waiting to be flipped. */
function heartbeat(times = 6) {
  for (let i = 0; i < times; i += 1) {
    tone(58, 0.16, 0.16, 'sine', i * 0.62);
    tone(52, 0.14, 0.11, 'sine', i * 0.62 + 0.19);
  }
}
function fanfare(big: boolean) {
  const c = audio(); if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.28);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.38, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.5);
  const run = big ? [392, 523, 659, 784, 1047, 1319] : [523, 659, 784];
  run.forEach((f, i) => tone(f, big ? 1.5 : 0.6, 0.15, 'triangle', 0.05 + i * 0.085));
}

export function DropPackReveal({
  prize, remaining, autoOpen, onDone,
}: {
  prize: RevealPrize;
  remaining: number;
  /** Batch mode — rip without waiting for the tap. Big pulls still stop. */
  autoOpen?: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('sealed');
  const timers = useRef<number[]>([]);

  const kind = prize.kind;
  const tier = TIER[kind];
  const teaseColor = kind === 'none' ? TEASE.none : TEASE.win;
  /**
   * ANY win stops and waits for you to flip it (Richard 2026-08-02). Only a
   * genuinely empty pack resolves itself — winning 2 spins should still be a
   * moment you choose to open, not something that flashes past.
   */
  const stops = kind !== 'none';
  /** Gold and flame get the longer hold, the rays and the bigger sound. */
  const big = kind === 'jackhof' || kind === 'hof' || kind === 'jackpot';

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const flip = useCallback(() => {
    setPhase((p) => {
      if (p !== 'torn') return p;
      fanfare(big);
      later(onDone, big ? 4600 : 2000);
      return 'flipped';
    });
  }, [big, onDone]);

  const open = useCallback(() => {
    setPhase((p) => {
      if (p !== 'sealed') return p;
      rip();
      later(() => {
        setPhase('torn');
        if (stops) {
          // It stopped. That pause IS the tell — you hit something big.
          heartbeat(7);
        } else {
          // Common: resolves on its own about a second later.
          later(flip, 950);
        }
      }, 420);
      return p === 'sealed' ? 'sealed' : p;
    });
  }, [stops, flip]);

  // Kick the rip off immediately in batch mode.
  useEffect(() => {
    clear();
    setPhase('sealed');
    if (autoOpen) later(open, 260);
    return clear;
  }, [prize, autoOpen, open]);

  const torn = phase !== 'sealed';
  const label = kind === 'jackhof' ? 'JACKHOF SEAT'
    : kind === 'jackpot' ? 'JACKPOT SEAT'
      : kind === 'hof' ? 'HOF SEAT'
        : kind === 'spins' ? `${prize.spins} SPIN${prize.spins === 1 ? '' : 'S'}`
        : 'EMPTY';
  const meta = kind === 'jackhof' ? 'Seat in the JackHOF draft'
    : kind === 'jackpot' ? 'Seat in the next Jackpot draft'
      : kind === 'hof' ? 'Seat in the next HOF draft'
        : kind === 'spins' ? 'Banana Wheel' : '';

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#020204]/95 select-none"
      onClick={() => (phase === 'sealed' ? open() : phase === 'torn' && stops ? flip() : undefined)}
    >
      {/* Rays behind a big flipped card */}
      {phase === 'flipped' && big && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <div className="drop-rays" style={{
            width: 1800, height: 1800,
            background: `repeating-conic-gradient(${tier.edge}00 0deg 6deg, ${tier.edge}55 6deg 8deg)`,
            maskImage: 'radial-gradient(circle,#000 8%,transparent 60%)',
            WebkitMaskImage: 'radial-gradient(circle,#000 8%,transparent 60%)',
          }} />
        </div>
      )}

      <div className={`relative w-[210px] h-[300px] ${torn ? 'drop-packwrap-torn' : ''}`}>
        {/* ── The pack ─────────────────────────────────────────────── */}
        <div className={`drop-pack absolute inset-0 rounded-xl overflow-hidden ${torn ? 'drop-pack-open' : ''}`}>
          <span className="absolute top-[64px] left-0 right-0 flex flex-col items-center gap-2">
            <Image src="/sbs-logo-white-v2.png" alt="" width={58} height={58}
              className="w-[58px] h-auto" priority />
            <span className="font-black text-xl tracking-[0.2em] text-white/90">SBS</span>
          </span>
          <span className="drop-band absolute -left-4 -right-4 top-[60%] h-11 flex items-center justify-center">
            <span className="text-[#0a0a0f] font-black text-[17px] tracking-[0.08em] uppercase">
              Banana Pack
            </span>
          </span>
          <span className="absolute bottom-5 left-0 right-0 text-center text-[11px] font-bold tracking-[0.16em] uppercase text-white/50">
            1 prize inside
          </span>
        </div>

        {/* The tease — the tier colour showing in the tear. Never the prize. */}
        <div className={`drop-tease absolute top-0.5 left-2 right-2 h-2 rounded ${torn ? 'drop-tease-on' : ''}`}
          style={{ background: teaseColor }} />

        {/* The striped foil crimp that tears away */}
        <div className={`drop-crimp absolute top-0 left-0 right-0 h-7 rounded-t-xl ${torn ? 'drop-crimp-torn' : ''}`} />

        {/* ── The prize card rising out ────────────────────────────── */}
        <div className={`drop-rise absolute left-1/2 -ml-[90px] bottom-[60px] w-[180px] h-[254px] ${
          torn ? 'drop-rise-up' : ''} ${phase === 'torn' && stops ? 'drop-tremble' : ''}`}>
          <div className={`drop-flipper relative w-full h-full ${phase === 'flipped' ? 'drop-flipped' : ''}`}>
            {/* back */}
            <div className="drop-face absolute inset-0 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(160deg,#1a1a24,#0a0a0f)', outline: '1px solid #33333f', outlineOffset: -1 }}>
              <Image src="/sbs-logo-white-v2.png" alt="" width={70} height={70} className="w-[70px] h-auto opacity-90" />
              <span className="absolute left-2.5 right-2.5 bottom-2 h-2 rounded" style={{ background: teaseColor }} />
            </div>
            {/* front */}
            <div className="drop-face drop-face-front absolute inset-0 rounded-xl overflow-hidden flex flex-col"
              style={{
                background: `linear-gradient(200deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 34%), linear-gradient(160deg, ${tier.top} 0%, #14141c 62%, #0c0c12 100%)`,
                border: `2px solid ${tier.edge}`,
              }}>
              <div className="px-3 pt-3" />
              <div className="h-16 mx-2.5 mt-4 mb-0.5 flex items-center justify-center">
                <Image src="/sbs-logo-white-v2.png" alt="" width={46} height={46}
                  className="w-[46px] h-auto" style={{ opacity: kind === 'none' ? 0.3 : 0.95 }} />
              </div>
              <div className="px-2 pt-0.5 text-center font-extrabold text-base leading-tight uppercase tracking-[0.04em] text-white">
                {label}
              </div>
              {meta && (
                <div className="pt-1 text-center text-[11px] uppercase tracking-[0.08em] text-white/45">
                  {meta}
                </div>
              )}
              <div className="mt-auto flex justify-between items-center px-3 py-2 border-t border-white/10 text-[9px] uppercase tracking-[0.1em] text-white/35">
                <span>Banana Pack</span><span>The Drop</span>
              </div>
              {phase === 'flipped' && <span className="drop-shine absolute -top-[20%] -bottom-[20%] w-[46%]" />}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-24 text-[11px] font-bold uppercase tracking-[0.28em] text-white/45">
        {phase === 'sealed' ? 'tap to rip'
          : phase === 'torn' && stops ? 'it stopped — flip it yourself'
            : remaining > 0 ? `${remaining} more` : ''}
      </p>

      <style jsx>{`
        .drop-pack{
          background:linear-gradient(160deg,#22222e 0%,#12121a 55%,#0a0a0f 100%);
          outline:1px solid #33333f; outline-offset:-1px;
          animation:drop-bob 3.2s ease-in-out infinite;
          transition:transform .45s ease, opacity .45s ease;
        }
        /* Gone, not dimmed. Leaving a ghost pack behind the prize card just
           made the reveal look cluttered (Richard 2026-08-02). */
        .drop-pack-open{opacity:0; transform:translateY(26px) scale(.94); animation:none}
        @keyframes drop-bob{
          0%,100%{transform:translateY(0) rotate(0)}
          50%{transform:translateY(-7px) rotate(-1.2deg)}
        }
        .drop-band{background:linear-gradient(90deg,#f59e0b,#fbbf24 40%,#fcd34d); transform:rotate(-6deg)}
        .drop-crimp{
          background:repeating-linear-gradient(90deg,#3a3a46 0 3px,#1a1a24 3px 6px);
          transition:transform .5s cubic-bezier(.3,.6,.3,1), opacity .5s ease; z-index:3;
        }
        .drop-crimp-torn{transform:translateY(-110px) rotate(-14deg); opacity:0}
        .drop-tease{opacity:0; z-index:2}
        .drop-tease-on{opacity:1; animation:drop-teasepulse 1s ease-in-out infinite}
        @keyframes drop-teasepulse{
          0%,100%{opacity:.55; transform:scaleX(.97)} 50%{opacity:1; transform:scaleX(1)}
        }
        .drop-rise{
          transform:translateY(40px); opacity:0; perspective:1200px; z-index:4;
          transition:transform .8s cubic-bezier(.2,.7,.25,1.12), opacity .5s ease;
        }
        .drop-rise-up{transform:translateY(-96px); opacity:1}
        .drop-tremble{animation:drop-tremble .8s ease-in-out .8s infinite}
        @keyframes drop-tremble{
          0%,100%{transform:translateY(-96px) rotate(0)}
          25%{transform:translateY(-100px) rotate(-1.1deg)}
          75%{transform:translateY(-93px) rotate(1.1deg)}
        }
        .drop-flipper{transform-style:preserve-3d; transition:transform .6s cubic-bezier(.2,.7,.3,1)}
        .drop-flipped{transform:rotateY(180deg)}
        .drop-face{backface-visibility:hidden}
        .drop-face-front{transform:rotateY(180deg)}
        .drop-shine{
          left:-60%; transform:skewX(-18deg); pointer-events:none;
          background:linear-gradient(105deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.28) 50%,rgba(255,255,255,0) 100%);
          animation:drop-shine .9s ease .45s both;
        }
        @keyframes drop-shine{from{left:-60%} to{left:120%}}
        .drop-rays{animation:drop-rays 1.1s cubic-bezier(.16,1,.3,1) forwards, drop-spin 30s linear 1.1s infinite}
        @keyframes drop-rays{
          0%{transform:rotate(0) scale(.2); opacity:0}
          100%{transform:rotate(46deg) scale(1); opacity:.8}
        }
        @keyframes drop-spin{to{transform:rotate(406deg) scale(1)}}
        @media (prefers-reduced-motion: reduce){
          .drop-pack,.drop-crimp,.drop-tease-on,.drop-rise,.drop-tremble,
          .drop-flipper,.drop-shine,.drop-rays{animation:none !important; transition:none}
        }
      `}</style>
    </div>
  );
}
