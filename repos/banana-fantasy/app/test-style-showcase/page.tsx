'use client';

/**
 * Clean "obsidian" design language — showcase (TEMP, safe to delete).
 *
 * 1. JP / HOF / Pro draft-type treatments in the new clean direction (3 options),
 *    keeping the reserved JP red / HOF gold.
 * 2. Examples of high-impact pages restyled into the same language (so the whole
 *    site feels cohesive): How It Works steps, Jackpot/HOF feature cards,
 *    notification rows.
 * 3. The prioritized migration list.
 *
 * Live at /test-style-showcase.
 */

const JP = '#ef4444';
const HOF = '#D4AF37';
const PRO = '#a855f7';

/* ── thin line icons (SF-Symbols vibe) ─────────────────────────────── */
const I = {
  bolt: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>,
  crown: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"><path d="M4 18h16M4 18l-1.5-9 5 4 4.5-7 4.5 7 5-4L20 18" /></svg>,
  layers: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5" /></svg>,
  ticket: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4z" /></svg>,
  football: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M5 19C4 13 8 5 19 5c1 6-3 14-14 14zM9 15l6-6M11 9h2v2M13 13h2v2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chart: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7" /></svg>,
  trophy: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 18h6M10 18v-3M14 18v-3M8 21h8" /></svg>,
  gift: (c = '') => <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"><rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M3.5 13h17M12 9v11M12 9S10.5 5 8 5a2 2 0 0 0 0 4zM12 9s1.5-4 4-4a2 2 0 0 1 0 4z" /></svg>,
};

function meta(t: 'jackpot' | 'hof' | 'pro') {
  if (t === 'jackpot') return { color: JP, label: 'JACKPOT', word: 'Jackpot', pct: '1%', icon: I.bolt, blurb: 'Win your league, skip to the Finals.' };
  if (t === 'hof') return { color: HOF, label: 'HALL OF FAME', word: 'HOF', pct: '5%', icon: I.crown, blurb: 'Compete for a bonus prize pool.' };
  return { color: '#9aa0aa', accent: PRO, label: 'PRO', word: 'Pro', pct: '94%', icon: I.layers, blurb: 'The standard draft.' };
}
const TYPES = ['jackpot', 'hof', 'pro'] as const;

/* OPTION A — quiet pill badges (replaces filled colored pills) */
function BadgeRow() {
  return (
    <div className="flex flex-wrap gap-2.5">
      {TYPES.map(t => {
        const m = meta(t);
        return (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold tracking-wide"
            style={{ color: m.color, background: `${m.color}1A`, boxShadow: `inset 0 0 0 1px ${m.color}40` }}>
            <span className="w-[14px] h-[14px]">{m.icon('w-[14px] h-[14px]')}</span>{m.label}
          </span>
        );
      })}
    </div>
  );
}

/* OPTION B — top-band cards (a hairline accent band + word, obsidian body) */
function BandCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {TYPES.map(t => {
        const m = meta(t);
        return (
          <div key={t} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="h-1" style={{ background: m.color }} />
            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: m.color }}>
                  <span className="w-4 h-4">{m.icon('w-4 h-4')}</span>{m.word}
                </span>
                <span className="text-[12px] font-semibold tabular-nums" style={{ color: m.color }}>{m.pct}</span>
              </div>
              <p className="text-white/50 text-[12px] mt-2 leading-relaxed">{m.blurb}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* OPTION C — selection cards (the draft-page picker), accent dot + line icon,
   NO gradient fills. Pro stays neutral so JP/HOF pop. */
function PickerCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {TYPES.map(t => {
        const m = meta(t);
        return (
          <button key={t} className="relative text-left rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-colors">
            <span className="absolute top-3.5 right-3.5 h-2 w-2 rounded-full" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
            <span className="flex items-center justify-center w-9 h-9 rounded-xl mb-3" style={{ color: m.color, background: `${m.color}14` }}>
              <span className="w-[18px] h-[18px]">{m.icon('w-[18px] h-[18px]')}</span>
            </span>
            <div className="flex items-baseline gap-2">
              <h4 className="text-white text-[14px] font-semibold tracking-tight">{m.word}</h4>
              <span className="text-[12px] font-bold tabular-nums" style={{ color: m.color }}>{m.pct}</span>
            </div>
            <p className="text-white/50 text-[12px] mt-1 leading-relaxed">{m.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

/* Draft-row band (how a live draft row reads with the clean accent) */
function DraftRowExample({ t }: { t: 'jackpot' | 'hof' | 'pro' }) {
  const m = meta(t);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span className="w-1 self-stretch rounded-full" style={{ background: m.color }} />
      <span className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ color: m.color, background: `${m.color}14` }}>{m.icon('w-4 h-4')}</span>
      <div className="flex-1 min-w-0">
        <p className="text-white text-[13px] font-semibold">{m.label} <span className="text-white/40 font-normal">· Draft #182</span></p>
        <p className="text-white/40 text-[11px]">Filling · 7/10</p>
      </div>
      <span className="text-[12px] font-semibold" style={{ color: m.color }}>{m.pct}</span>
    </div>
  );
}

/* ── "restyled page" examples for cohesion ─────────────────────────── */
function StepsExample() {
  const steps = [
    { n: '01', icon: I.ticket, t: 'Get a pass', d: '$25 each — card or USDC.' },
    { n: '02', icon: I.football, t: 'Draft a team', d: 'Snake draft team-positions, not players.' },
    { n: '03', icon: I.chart, t: 'Watch it score', d: 'Best-ball — your top scorers auto-count.' },
    { n: '04', icon: I.trophy, t: 'Win prizes', d: 'Top finishers advance through playoffs.' },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {steps.map(s => (
        <div key={s.n} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <span className="text-white/25 text-[13px] font-bold tabular-nums pt-0.5">{s.n}</span>
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-banana/10 text-banana shrink-0">{s.icon('w-[18px] h-[18px]')}</span>
          <div><h4 className="text-white text-[14px] font-semibold">{s.t}</h4><p className="text-white/50 text-[12px] mt-0.5 leading-relaxed">{s.d}</p></div>
        </div>
      ))}
    </div>
  );
}
function NotiRowsExample() {
  const rows = [
    { icon: I.football, t: 'Your draft filled', d: 'Draft #182 is starting now', accent: '#fbbf24' },
    { icon: I.trophy, t: 'You placed 2nd', d: 'League #44 — prize on the way', accent: '#34d399' },
    { icon: I.gift, t: 'Reward ready to claim', d: '1 free spin from a promo', accent: '#fbbf24' },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
          <span className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ color: r.accent, background: `${r.accent}14` }}>{r.icon('w-[18px] h-[18px]')}</span>
          <div className="flex-1 min-w-0"><p className="text-white text-[13.5px] font-medium">{r.t}</p><p className="text-white/45 text-[12px]">{r.d}</p></div>
          <span className="h-2 w-2 rounded-full bg-banana shrink-0" />
        </div>
      ))}
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-white text-[16px] font-semibold">{title}</h2>
      {blurb && <p className="text-white/45 text-[12.5px] mt-0.5 mb-4 leading-relaxed max-w-xl">{blurb}</p>}
      {!blurb && <div className="mb-4" />}
      {children}
    </div>
  );
}
function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-white/35 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2.5">{label}</p>
      {children}
    </div>
  );
}

const MIGRATE: { page: string; impact: 'High' | 'Med' | 'Low'; note: string }[] = [
  { page: 'How It Works / FAQ', impact: 'High', note: 'emoji + multicolor gradient steps → numbered line-icon tiles' },
  { page: 'Jackpot & HOF page', impact: 'High', note: 'emoji headers + pulsing radial gradients → clean accent-dot cards' },
  { page: 'Drafts hub (/draft)', impact: 'High', note: 'colored gradient type cards → neutral cards + accent dot/line icon' },
  { page: 'Notifications', impact: 'High', note: '20+ emoji icon types → monochrome line icons + clean rows' },
  { page: 'Banana Wheel / reveal', impact: 'High', note: 'emoji + filled colors → mono wheel + thin JP/HOF/Pro icons' },
  { page: 'Profile', impact: 'Med', note: 'heavy motion + emoji empty states → fade-only + line icons' },
  { page: 'Winnings', impact: 'Med', note: 'emoji in history rows → trophy / arrow line icons (keep gradient hero)' },
  { page: 'Featured contest card', impact: 'Med', note: 'glow + ring → hairline border, restrained prize scale' },
  { page: 'History', impact: 'Low', note: 'emoji empty state → list icon; structure already clean' },
];

export default function TestStyleShowcase() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-white text-2xl font-bold tracking-tight">Clean design language — site-wide</h1>
        <p className="text-white/45 text-sm mt-1.5 mb-9 leading-relaxed">
          The same obsidian direction as the header / promos / notifications: thin line icons, <code className="text-white/60">bg-white/[0.02]</code> surfaces,
          hairline borders, one banana accent, and the reserved <span style={{ color: JP }}>JP red</span> / <span style={{ color: HOF }}>HOF gold</span> used sparingly.
        </p>

        <Section title="Jackpot / HOF / Pro — draft-type looks" blurb="Three clean ways to show draft type, all keeping JP red / HOF gold but using them as restrained accents instead of big filled blocks. Pick one (or mix per surface).">
          <Sub label="Option A — quiet pill badges">
            <BadgeRow />
          </Sub>
          <Sub label="Option B — top-band cards">
            <BandCards />
          </Sub>
          <Sub label="Option C — picker cards (draft page) · accent dot + line icon">
            <PickerCards />
          </Sub>
          <Sub label="Live draft rows (with the clean accent)">
            <div className="space-y-2">
              {TYPES.map(t => <DraftRowExample key={t} t={t} />)}
            </div>
          </Sub>
        </Section>

        <Section title="How It Works — restyled" blurb="Numbered tiles + line icons instead of big emoji on multicolor gradients.">
          <StepsExample />
        </Section>

        <Section title="Notifications — restyled" blurb="Monochrome line icons + clean rows instead of 20+ emoji icon types.">
          <NotiRowsExample />
        </Section>

        <Section title="Where to apply it next" blurb="Prioritized by how often users see it and how off-style it is today.">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            {MIGRATE.map((m, i) => (
              <div key={m.page} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${m.impact === 'High' ? 'bg-banana/15 text-banana' : m.impact === 'Med' ? 'bg-white/10 text-white/60' : 'bg-white/[0.06] text-white/40'}`}>{m.impact}</span>
                <span className="text-white text-[13px] font-medium w-40 shrink-0">{m.page}</span>
                <span className="text-white/45 text-[12px] leading-snug">{m.note}</span>
              </div>
            ))}
          </div>
        </Section>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-white/70 text-sm font-medium mb-1">How to use this</p>
          <p className="text-white/45 text-[12.5px] leading-relaxed">Tell me which draft-type option (A/B/C) you like, and which pages from the list you want done first. I&apos;ll roll them out surface by surface so the whole site lands on one clean language.</p>
        </div>
      </div>
    </div>
  );
}
