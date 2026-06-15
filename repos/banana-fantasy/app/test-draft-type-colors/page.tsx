'use client';

/**
 * Jackpot / HOF in-draft band — FAITHFUL replica vs options (TEMP, delete later).
 * Live at /test-draft-type-colors. Replicates the real draft-room band exactly:
 * dark #222 draft boxes (avatar + name + R/P + position-needs row, picked slots
 * get a position-colored bottom bar) sitting on the type-colored band. Only the
 * BAND changes per type/option — the boxes are always dark, like the real thing.
 */

type T = 'jackpot' | 'hof';
const POS = { QB: '#FF474C', RB: '#3c9120', WR: '#cb6ce6', TE: '#326cf8', DST: '#DF893E' } as const;
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;

// EXACT current band values (lib/draftBandStyle.ts).
const JP_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.20) 100%), ' +
  'radial-gradient(130% 130% at 50% -12%, #E63A40 0%, #C71F29 46%, #8E141C 100%)';
const HOF_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.18) 100%), ' +
  'linear-gradient(180deg,#F4DC7A 0%,#DCB845 40%,#BE9430 72%,#A37C26 100%)';
const GLASS = 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.5), 0 10px 34px rgba(0,0,0,0.5)';

type Band = { bg: string; shadow: string; word: string; wordShadow?: string; status: string };
function bandFor(tr: 'current' | 'deep' | 'accent', t: T): Band {
  if (tr === 'current') return t === 'jackpot'
    ? { bg: JP_BAND, shadow: GLASS, word: '#fff', wordShadow: '0 1px 4px rgba(0,0,0,0.5)', status: '#fff' }
    : { bg: HOF_BAND, shadow: GLASS, word: '#241900', wordShadow: '0 1px 0 rgba(255,255,255,0.35)', status: '#231900' };
  if (tr === 'deep') return t === 'jackpot'
    ? { bg: 'linear-gradient(180deg,#c5212b 0%,#3a0c0e 100%)', shadow: 'inset 0 1px 0 rgba(255,255,255,0.10),0 8px 28px rgba(0,0,0,0.5)', word: '#fff', wordShadow: '0 1px 3px rgba(0,0,0,0.5)', status: '#ffd9da' }
    : { bg: 'linear-gradient(180deg,#bd932f 0%,#3a2c0d 100%)', shadow: 'inset 0 1px 0 rgba(255,255,255,0.12),0 8px 28px rgba(0,0,0,0.5)', word: '#fff7e0', wordShadow: '0 1px 2px rgba(0,0,0,0.45)', status: '#f3e4b0' };
  const c = t === 'jackpot' ? '#ff5a5f' : '#e3b84a';
  return { bg: 'linear-gradient(180deg,#13141a 0%,#0d0e12 100%)', shadow: `inset 0 -2px 0 ${c},0 8px 28px rgba(0,0,0,0.5)`, word: c, status: '#cfd2da' };
}

const COUNTS = { QB: 1, RB: 1, WR: 2, TE: 0, DST: 0 };
function NeedsRow() {
  return (
    <div className="flex" style={{ minHeight: 48, color: '#fff' }}>
      {POS_ORDER.map(p => (
        <div key={p} style={{ flex: 1, borderTop: `2px solid ${POS[p]}`, textAlign: 'center' }}>
          <p style={{ fontSize: 9 }}>{p}</p>
          <p style={{ fontSize: 11 }}>{COUNTS[p]}</p>
        </div>
      ))}
    </div>
  );
}
function Avatar({ ring }: { ring?: boolean }) {
  return <div className="mx-auto rounded-full" style={{ width: 40, height: 40, background: '#3a3a44', border: ring ? '2px solid #F3E216' : '1px solid rgba(255,255,255,0.15)' }} />;
}

type Pick = { name: string; r: number; p: number } & (
  | { state: 'picked'; pos: keyof typeof POS; player: string }
  | { state: 'current' } | { state: 'upcoming' });

const PICKS: Pick[] = [
  { name: 'Mike', r: 1, p: 1, state: 'picked', pos: 'WR', player: 'CeeDee Lamb' },
  { name: 'Sarah', r: 1, p: 2, state: 'picked', pos: 'RB', player: 'Bijan' },
  { name: 'You', r: 1, p: 3, state: 'current' },
  { name: 'Alex', r: 1, p: 4, state: 'upcoming' },
];

function Box({ pick }: { pick: Pick }) {
  const isYou = pick.name === 'You';
  const border = isYou ? '#F3E216' : pick.state === 'current' ? '#fff' : '#444';
  return (
    <div className="flex-shrink-0 text-center overflow-hidden" style={{ minWidth: 116, flex: 1, padding: '10px 0 0', borderRadius: 5, border: `1px solid ${border}`, background: '#222' }}>
      <Avatar ring={isYou} />
      <div className="mt-1.5 font-bold" style={{ fontSize: 12, color: '#fff' }}>{pick.name}</div>
      {pick.state === 'current'
        ? <div style={{ fontWeight: 'bold', fontSize: 15, marginTop: 2, color: '#fff' }}>0:24</div>
        : <div className="flex justify-center" style={{ gap: 12, marginTop: 2, paddingBottom: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', opacity: 0.7 }}>R{pick.r}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', opacity: 0.7 }}>P{pick.p}</span>
          </div>}
      {pick.state === 'upcoming' && <NeedsRow />}
      {pick.state === 'current' && <div style={{ borderBottom: '5px solid #fff' }}><NeedsRow /></div>}
      {pick.state === 'picked' && (
        <div style={{ borderBottom: `5px solid ${POS[pick.pos]}`, height: 50 }}>
          <p style={{ fontWeight: 800, fontSize: 13, paddingTop: 6, color: '#fff' }}>{pick.player}</p>
        </div>
      )}
    </div>
  );
}

function DraftBand({ band, t }: { band: Band; t: T }) {
  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
      <div style={{ background: band.bg, boxShadow: band.shadow }} className="px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-black uppercase" style={{ fontSize: 16, lineHeight: 1, letterSpacing: '0.14em', color: band.word, textShadow: band.wordShadow }}>
            {t === 'jackpot' ? 'JACKPOT' : 'HOF'}
          </span>
          <span className="ml-auto flex gap-1.5">
            {['← EXIT', 'MUTE 🎵', '✈️ OFF'].map(b => (
              <span key={b} className="text-[10px] px-1 py-0.5 rounded border" style={{ borderColor: 'rgba(255,255,255,0.4)', color: band.word }}>{b}</span>
            ))}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto banner-no-scrollbar">
          {PICKS.map((p, i) => <Box key={i} pick={p} />)}
        </div>
        <p className="text-center uppercase text-[12px] font-bold mt-2.5" style={{ color: band.status }}>
          You&apos;re on the clock — make your pick! · Pick 3 / 150
        </p>
      </div>
    </div>
  );
}

function Section({ title, sub, tr, rec }: { title: string; sub: string; tr: 'current' | 'deep' | 'accent'; rec?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-white font-semibold text-[14px]">{title}</p>
        {rec && <span className="text-[10px] font-bold uppercase tracking-wide text-banana bg-banana/15 px-1.5 py-0.5 rounded">Rec</span>}
      </div>
      <p className="text-white/40 text-xs mb-3">{sub}</p>
      <div className="space-y-4">
        <DraftBand band={bandFor(tr, 'jackpot')} t="jackpot" />
        <DraftBand band={bandFor(tr, 'hof')} t="hof" />
      </div>
    </div>
  );
}

export default function TestDraftTypeColors() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-2xl mx-auto space-y-9">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">In-draft Jackpot / HOF band — current vs options</h1>
          <p className="text-white/45 text-sm mt-1.5 leading-relaxed">
            The real top band while you draft — the colored band holds the dark draft boxes (avatar, name, round/pick,
            position needs; picked slots show the player with a position-colored bar). The boxes are always dark — only
            the band color changes. Each block shows Jackpot (top) + HOF (bottom).
          </p>
        </div>
        <Section title="Current (exact, live now)" sub="Glossy red / metallic gold band — what's live today." tr="current" />
        <Section title="Option A — Deep" rec sub="Same red/gold but deep → near-black; premium + restrained, boxes pop more." tr="deep" />
        <Section title="Option B — Dark + accent" sub="Near-black band, color via a bottom accent line + the colored word. Most minimal." tr="accent" />
        <p className="text-white/35 text-xs">
          My pick: <b className="text-white/60">Option A (Deep)</b>. Tell me which and I&apos;ll wire it into <code>lib/draftBandStyle.ts</code> (one file → filling, reveal + drafting bands all update together).
        </p>
      </div>
    </div>
  );
}
