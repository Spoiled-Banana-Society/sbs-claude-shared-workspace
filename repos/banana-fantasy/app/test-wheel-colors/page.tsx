'use client';

/**
 * Wheel color options — current vs alternatives (TEMP, safe to delete).
 * Live at /test-wheel-colors. Focus: the "2 Drafts" segment + overall legibility.
 */

type Seg = { label: string; color: string };

// Current palette (lib/wheelConfig.ts). Note: 2 Drafts (#a3e635 lime) is bright
// + close to 5 Drafts green, and low-contrast under white text.
const CURRENT: Seg[] = [
  { label: '1 Draft', color: '#94a3b8' },
  { label: '5 Drafts', color: '#22c55e' },
  { label: 'Jackpot', color: '#ef4444' },
  { label: '2 Drafts', color: '#a3e635' },
  { label: '10 Drafts', color: '#a78bfa' },
  { label: 'HOF', color: '#d4af37' },
];

// Option A — "Teal": 2 Drafts → teal (clearly distinct from the green 5 Drafts),
// darker slate for 1 Draft + richer violet so white text reads everywhere.
const OPT_A: Seg[] = [
  { label: '1 Draft', color: '#64748b' },
  { label: '5 Drafts', color: '#22c55e' },
  { label: 'Jackpot', color: '#ef4444' },
  { label: '2 Drafts', color: '#14b8a6' },
  { label: '10 Drafts', color: '#8b5cf6' },
  { label: 'HOF', color: '#d4af37' },
];

// Option B — "Jewel": cooler, deeper tones; every wedge a distinct hue family.
const OPT_B: Seg[] = [
  { label: '1 Draft', color: '#475569' },
  { label: '5 Drafts', color: '#10b981' },
  { label: 'Jackpot', color: '#ef4444' },
  { label: '2 Drafts', color: '#0ea5e9' },
  { label: '10 Drafts', color: '#6366f1' },
  { label: 'HOF', color: '#d4af37' },
];

// Option C — keep current but ONLY fix 2 Drafts → teal (minimal change).
const OPT_C: Seg[] = CURRENT.map(s => (s.label === '2 Drafts' ? { ...s, color: '#14b8a6' } : s));

function Wheel({ segs }: { segs: Seg[] }) {
  const cx = 100, cy = 100, r = 92;
  const n = segs.length;
  const step = (Math.PI * 2) / n;
  const start = -Math.PI / 2;
  const path = (i: number) => {
    const a0 = start + i * step, a1 = start + (i + 1) * step;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
  };
  const labelPos = (i: number) => {
    const a = start + (i + 0.5) * step;
    return { x: cx + r * 0.6 * Math.cos(a), y: cy + r * 0.6 * Math.sin(a), a: (a * 180) / Math.PI };
  };
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[230px] mx-auto">
      {segs.map((s, i) => <path key={i} d={path(i)} fill={s.color} stroke="#0a0a0f" strokeWidth={1.5} />)}
      {segs.map((s, i) => {
        const p = labelPos(i);
        return (
          <text key={i} x={p.x} y={p.y} fill="#fff" fontSize="7.5" fontWeight="800"
            textAnchor="middle" dominantBaseline="middle"
            transform={`rotate(${p.a + 90} ${p.x} ${p.y})`}
            style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 0.6 }}>
            {s.label}
          </text>
        );
      })}
      <circle cx={cx} cy={cy} r={11} fill="#1a1a25" stroke="#fbbf24" strokeWidth={1.2} />
    </svg>
  );
}

function Card({ title, sub, segs, recommended }: { title: string; sub: string; segs: Seg[]; recommended?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${recommended ? 'border-banana/40 bg-banana/[0.04]' : 'border-white/[0.07] bg-white/[0.02]'}`}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-white font-semibold text-[15px]">{title}</p>
        {recommended && <span className="text-[10px] font-bold uppercase tracking-wide text-banana bg-banana/15 px-1.5 py-0.5 rounded">Rec</span>}
      </div>
      <p className="text-white/40 text-xs mb-4">{sub}</p>
      <Wheel segs={segs} />
      <div className="flex flex-wrap gap-1.5 mt-4 justify-center">
        {segs.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] text-white/55">
            <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} /> {s.label}
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
          Jackpot stays red, HOF stays gold (sacred). The issue today: <b className="text-white/70">2 Drafts</b> is bright
          lime <code className="text-white/60">#a3e635</code> — low contrast under white text and too close to the green
          5 Drafts. Options below fix that and tidy the rest for legibility.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Card title="Current" sub="2 Drafts = lime, two greens sit side by side" segs={CURRENT} />
          <Card title="Option C — minimal" sub="Only 2 Drafts → teal, everything else untouched" segs={OPT_C} recommended />
          <Card title="Option A — Teal" sub="Teal 2 Drafts + darker slate + violet 10 Drafts" segs={OPT_A} />
          <Card title="Option B — Jewel" sub="Cooler, deeper, every wedge a distinct hue" segs={OPT_B} />
        </div>
        <p className="text-white/35 text-xs mt-8">
          My pick: <b className="text-white/60">Option C</b> (smallest change, fixes the exact problem) or <b className="text-white/60">Option A</b> if you
          want the whole wheel a touch more premium. Tell me which and I&apos;ll apply it to <code>lib/wheelConfig.ts</code>.
        </p>
      </div>
    </div>
  );
}
