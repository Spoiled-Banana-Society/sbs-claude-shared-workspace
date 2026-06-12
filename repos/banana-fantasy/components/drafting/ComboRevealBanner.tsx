'use client';

import { useEffect, useState } from 'react';

export type ComboKind = 'jackpot-jackpot' | 'hof-hof' | 'mixed';

interface ComboConfig {
  title: string;
  subtitle: string;
  perk: string;
  colors: string[];       // confetti/ray palette
  glowFrom: string;
  glowTo: string;
  titleClass: string;     // gradient text
}

const COMBOS: Record<ComboKind, ComboConfig> = {
  'jackpot-jackpot': {
    title: 'DOUBLE JACKPOT',
    subtitle: 'JACKPOT × JACKPOT',
    perk: '1ST & 2ND SKIP STRAIGHT TO THE FINALS',
    colors: ['#ef4444', '#f97316', '#fbbf24', '#ffffff', '#ff6b6b', '#ffd93d'],
    glowFrom: '#ef4444',
    glowTo: '#fbbf24',
    titleClass: 'from-red-500 via-orange-400 to-yellow-300',
  },
  'hof-hof': {
    title: 'DOUBLE HALL OF FAME',
    subtitle: 'HOF × HOF',
    perk: '1ST & 2ND ENTER THE HOF PLAYOFFS',
    colors: ['#FFD700', '#FFA500', '#ffffff', '#fbbf24', '#ffe066', '#ffb347'],
    glowFrom: '#D4AF37',
    glowTo: '#fde68a',
    titleClass: 'from-yellow-300 via-amber-400 to-yellow-200',
  },
  'mixed': {
    title: 'JACKPOT × HOF',
    subtitle: 'WHEEL SPECIAL + SLOT SPECIAL',
    perk: '1ST TO THE FINALS + HOF PLAYOFFS',
    colors: ['#ef4444', '#fbbf24', '#FFD700', '#ffffff', '#f97316', '#ffe066'],
    glowFrom: '#ef4444',
    glowTo: '#FFD700',
    titleClass: 'from-red-500 via-yellow-300 to-amber-400',
  },
};

/**
 * The "screen goes insane" combo reveal — fires when a wheel-won special draft
 * ALSO lands a slot special. Full-screen, over-the-top: strobing rays, a
 * confetti storm, a slam-in title, and the combo perk. Self-contained
 * (scoped keyframes) so it can't disturb the rest of the draft room.
 */
export function ComboRevealBanner({ kind, onClose }: { kind: ComboKind; onClose?: () => void }) {
  const cfg = COMBOS[kind];
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Auto-dismiss the heavy overlay after the moment lands (countdown continues underneath).
    const t = setTimeout(() => onClose?.(), 6500);
    return () => clearTimeout(t);
  }, [onClose]);

  // 24 radiating rays + a confetti storm (2x the normal reveal).
  const rays = Array.from({ length: 24 }, (_, i) => i);
  const storm = Array.from({ length: 220 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 2.2 + Math.random() * 2.4,
    size: 6 + Math.random() * 10,
    color: cfg.colors[i % cfg.colors.length],
    rot: Math.random() * 360,
  }));

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden pointer-events-none"
      style={{ animation: 'comboFade 0.25s ease-out' }}
    >
      {/* radial strobe backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${cfg.glowFrom}55 0%, ${cfg.glowTo}22 28%, transparent 62%)`,
          animation: 'comboPulseBg 0.9s ease-in-out infinite',
        }}
      />

      {/* rotating rays */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ animation: 'comboSpin 14s linear infinite' }}>
        {rays.map((i) => (
          <div
            key={i}
            className="absolute origin-bottom"
            style={{
              width: '3px',
              height: '64vmax',
              bottom: '50%',
              left: '50%',
              background: `linear-gradient(to top, ${i % 2 ? cfg.glowFrom : cfg.glowTo}66, transparent 70%)`,
              transform: `translateX(-50%) rotate(${(360 / rays.length) * i}deg)`,
            }}
          />
        ))}
      </div>

      {/* confetti storm */}
      {storm.map((c) => (
        <span
          key={c.id}
          className="absolute top-[-8%] rounded-[2px]"
          style={{
            left: `${c.left}%`,
            width: `${c.size}px`,
            height: `${c.size * 1.6}px`,
            backgroundColor: c.color,
            transform: `rotate(${c.rot}deg)`,
            animation: `comboFall ${c.dur}s linear ${c.delay}s forwards`,
          }}
        />
      ))}

      {/* center text — slams in */}
      <div className={`relative text-center px-6 transition-all duration-500 ${mounted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} style={{ animation: mounted ? 'comboSlam 0.55s cubic-bezier(.2,1.4,.3,1)' : undefined }}>
        <p className="font-mono text-xs sm:text-sm tracking-[0.4em] text-white/80 mb-3">{cfg.subtitle}</p>
        <h1
          className={`font-extrabold uppercase leading-[0.95] bg-gradient-to-r ${cfg.titleClass} bg-clip-text text-transparent`}
          style={{
            fontSize: 'clamp(2.6rem, 11vw, 7rem)',
            filter: `drop-shadow(0 0 28px ${cfg.glowFrom}) drop-shadow(0 0 60px ${cfg.glowTo})`,
            animation: 'comboThrob 0.7s ease-in-out infinite',
          }}
        >
          {cfg.title}
        </h1>
        <div className="mt-5 inline-block rounded-full border border-white/25 bg-black/40 backdrop-blur-sm px-5 py-2">
          <p className="font-mono text-[11px] sm:text-sm font-bold tracking-widest text-white">{cfg.perk}</p>
        </div>
      </div>

      <style>{`
        @keyframes comboFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes comboPulseBg { 0%,100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.08) } }
        @keyframes comboSpin { to { transform: rotate(360deg) } }
        @keyframes comboFall { to { transform: translateY(112vh) rotate(720deg); opacity: .85 } }
        @keyframes comboSlam { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.12) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes comboThrob { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
      `}</style>
    </div>
  );
}
