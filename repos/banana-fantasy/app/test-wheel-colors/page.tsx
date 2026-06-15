'use client';

/**
 * Wheel color options — faithful replica of the real wheel (TEMP, delete later).
 * Live at /test-wheel-colors. Exact 12-segment model from lib/wheelConfig.ts
 * (1 Draft ×5, 5 Drafts ×2, 2/10/20 Drafts, Jackpot, HOF). Colors are per-PRIZE
 * so every repeat of a prize stays the same color across the whole wheel.
 */

type PrizeKey = 'one' | 'two' | 'five' | 'ten' | 'twenty' | 'jackpot' | 'hof';

// Exact wheel order (lib/wheelConfig.ts).
const ORDER: PrizeKey[] = ['one', 'five', 'one', 'jackpot', 'one', 'ten', 'two', 'hof', 'one', 'five', 'one', 'twenty'];
const LABEL: Record<PrizeKey, string> = {
  one: '1 Draft', two: '2 Drafts', five: '5 Drafts', ten: '10 Drafts', twenty: '20 Drafts', jackpot: 'Jackpot', hof: 'HOF',
};
const PRIZES: PrizeKey[] = ['one', 'two', 'five', 'ten', 'twenty', 'jackpot', 'hof'];

type Palette = Record<PrizeKey, string>;

// CURRENT (exact). Issues: 2 Drafts lime is low-contrast + close to 5 Drafts
// green; 20 Drafts amber is close to the brand banana/pointer yellow.
const CURRENT: Palette = { one: '#94a3b8', two: '#a3e635', five: '#22c55e', ten: '#a78bfa', twenty: '#f59e0b', jackpot: '#ef4444', hof: '#d4af37' };
// OPTION C — minimal: only 2 Drafts → teal. Everything else untouched.
const OPT_C: Palette = { ...CURRENT, two: '#14b8a6' };
// OPTION A — Teal + cleanup: darker slate 1 Draft, teal 2, violet 10, orange 20
// (further from banana), white text reads on all.
const OPT_A: Palette = { one: '#64748b', two: '#14b8a6', five: '#22c55e', ten: '#8b5cf6', twenty: '#f97316', jackpot: '#ef4444', hof: '#d4af37' };
// OPTION B — Jewel: cooler/deeper, every prize a distinct hue family.
const OPT_B: Palette = { one: '#475569', two: '#0ea5e9', five: '#10b981', ten: '#6366f1', twenty: '#f97316', jackpot: '#ef4444', hof: '#d4af37' };

function Wheel({ palette }: { palette: Palette }) {
  const segAngle = 360 / ORDER.length;
  return (
    <div className="relative w-full max-w-[260px] mx-auto aspect-square">
      {/* pointer (banana), exactly like the real wheel */}
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[24px] border-l-transparent border-r-transparent border-t-[#fbbf24]" />
      <div
        className="w-full h-full rounded-full overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.4),inset_0_0_0_3px_rgba(255,255,255,0.1)]"
        style={{ background: 'linear-gradient(145deg, rgba(30,30,40,1) 0%, rgba(15,15,20,1) 100%)' }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            {ORDER.map((k, i) => (
              <linearGradient key={i} id={`g-${i}`} x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor={palette[k]} stopOpacity="0.95" />
                <stop offset="50%" stopColor={palette[k]} stopOpacity="1" />
                <stop offset="100%" stopColor={palette[k]} stopOpacity="0.85" />
              </linearGradient>
            ))}
            <filter id="ts" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0.3" stdDeviation="0.2" floodColor="#000" floodOpacity="0.5" />
            </filter>
            <radialGradient id="cg"><stop offset="0%" stopColor="#2a2a3a" /><stop offset="100%" stopColor="#1a1a25" /></radialGradient>
          </defs>
          {ORDER.map((k, i) => {
            const a0 = (i * segAngle - 90) * (Math.PI / 180);
            const a1 = ((i + 1) * segAngle - 90) * (Math.PI / 180);
            const x1 = 50 + 50 * Math.cos(a0), y1 = 50 + 50 * Math.sin(a0);
            const x2 = 50 + 50 * Math.cos(a1), y2 = 50 + 50 * Math.sin(a1);
            const path = `M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`;
            const mid = ((i + 0.5) * segAngle - 90);
            const midRad = mid * (Math.PI / 180);
            const tx = 50 + 33 * Math.cos(midRad), ty = 50 + 33 * Math.sin(midRad);
            const label = LABEL[k];
            const fs = label.length > 8 ? 2.6 : 3.2;
            return (
              <g key={i}>
                <path d={path} fill={`url(#g-${i})`} stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
                <text x={tx} y={ty} fill="white" fontSize={fs} fontWeight="600" textAnchor="middle"
                  dominantBaseline="middle" transform={`rotate(${mid + 90}, ${tx}, ${ty})`} filter="url(#ts)"
                  style={{ letterSpacing: '0.02em' }}>{label}</text>
              </g>
            );
          })}
          <circle cx="50" cy="50" r="9" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="7" fill="url(#cg)" />
          <circle cx="50" cy="50" r="6.5" fill="none" stroke="#fbbf24" strokeWidth="0.8" opacity="0.5" />
          <text x="50" y="50.5" fill="#fbbf24" fontSize="3" fontWeight="800" textAnchor="middle" dominantBaseline="middle">SBS</text>
        </svg>
      </div>
    </div>
  );
}

function Card({ title, sub, palette, rec }: { title: string; sub: string; palette: Palette; rec?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${rec ? 'border-banana/40 bg-banana/[0.04]' : 'border-white/[0.07] bg-white/[0.02]'}`}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-white font-semibold text-[15px]">{title}</p>
        {rec && <span className="text-[10px] font-bold uppercase tracking-wide text-banana bg-banana/15 px-1.5 py-0.5 rounded">Rec</span>}
      </div>
      <p className="text-white/40 text-xs mb-4">{sub}</p>
      <Wheel palette={palette} />
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 justify-center">
        {PRIZES.map(k => (
          <span key={k} className="inline-flex items-center gap-1 text-[10px] text-white/55">
            <span className="w-3 h-3 rounded-sm" style={{ background: palette[k] }} /> {LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TestWheelColors() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Wheel colors — current vs options</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-8 leading-relaxed">
          Exact wheel (all 12 segments — 1 Draft ×5, 5 Drafts ×2, 2/10/20 Drafts, Jackpot, HOF). Each prize keeps one
          color across every repeat. Jackpot stays red, HOF stays gold. Fixing: <b className="text-white/70">2 Drafts</b> (lime,
          low-contrast + too close to 5 Drafts green) and <b className="text-white/70">20 Drafts</b> (amber, too close to the brand banana/pointer).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Card title="Current" sub="2 Drafts lime · 20 Drafts amber" palette={CURRENT} />
          <Card title="Option C — minimal" sub="Only 2 Drafts → teal, nothing else changes" palette={OPT_C} rec />
          <Card title="Option A — Teal" sub="Teal 2 · violet 10 · orange 20 · darker 1 Draft" palette={OPT_A} />
          <Card title="Option B — Jewel" sub="Cooler/deeper, every prize a distinct hue" palette={OPT_B} />
        </div>
        <p className="text-white/35 text-xs mt-8">
          My pick: <b className="text-white/60">Option C</b> (smallest change, fixes the exact problem) or <b className="text-white/60">Option A</b> if
          you also want 20 Drafts pulled away from the banana yellow. Tell me which and I apply it to <code>lib/wheelConfig.ts</code>.
        </p>
      </div>
    </div>
  );
}
