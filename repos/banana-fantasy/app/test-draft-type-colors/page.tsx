'use client';

/**
 * Jackpot / HOF in-draft band — faithful replica vs options (TEMP, delete later).
 * Live at /test-draft-type-colors. "Current" copies the REAL draft-room band
 * (lib/draftBandStyle.ts) exactly — the colored top band that holds your roster
 * strip + status line while you're drafting — for both Jackpot and HOF. Options
 * below are cleaner/more-legible takes on the same in-draft layout.
 */

type T = 'jackpot' | 'hof';

// ── EXACT current values from lib/draftBandStyle.ts ──────────────────────────
const JP_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.20) 100%), ' +
  'radial-gradient(130% 130% at 50% -12%, #E63A40 0%, #C71F29 46%, #8E141C 100%)';
const HOF_BAND =
  'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.18) 100%), ' +
  'linear-gradient(180deg,#F4DC7A 0%,#DCB845 40%,#BE9430 72%,#A37C26 100%)';
const GLASS_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.5), 0 10px 34px rgba(0,0,0,0.5)';

type Band = { bg: string; shadow: string; word: string; wordShadow?: string; status: string; chipBg: string; chipText: string };

function bandFor(treatment: 'current' | 'deep' | 'accent', t: T): Band {
  if (treatment === 'current') {
    return t === 'jackpot'
      ? { bg: JP_BAND, shadow: GLASS_SHADOW, word: '#ffffff', wordShadow: '0 1px 4px rgba(0,0,0,0.5)', status: '#ffffff', chipBg: 'rgba(0,0,0,0.22)', chipText: '#fff' }
      : { bg: HOF_BAND, shadow: GLASS_SHADOW, word: '#241900', wordShadow: '0 1px 0 rgba(255,255,255,0.35)', status: '#231900', chipBg: 'rgba(0,0,0,0.14)', chipText: '#241900' };
  }
  if (treatment === 'deep') {
    // Same red/gold identity, but deep + restrained (color → near-black) so the
    // band reads premium and never fights the board. White/cream text.
    return t === 'jackpot'
      ? { bg: 'linear-gradient(180deg,#c5212b 0%,#3a0c0e 100%)', shadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 8px 28px rgba(0,0,0,0.5)', word: '#fff', wordShadow: '0 1px 3px rgba(0,0,0,0.5)', status: '#ffd9da', chipBg: 'rgba(0,0,0,0.3)', chipText: '#fff' }
      : { bg: 'linear-gradient(180deg,#bd932f 0%,#3a2c0d 100%)', shadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 28px rgba(0,0,0,0.5)', word: '#fff7e0', wordShadow: '0 1px 2px rgba(0,0,0,0.45)', status: '#f3e4b0', chipBg: 'rgba(0,0,0,0.28)', chipText: '#fff7e0' };
  }
  // accent — near-black band, color signalled by a bottom accent line + the word
  // + a colored chip. Most Apple/minimal, highest legibility.
  const c = t === 'jackpot' ? '#ff5a5f' : '#e3b84a';
  return { bg: `linear-gradient(180deg,#13141a 0%,#0d0e12 100%)`, shadow: `inset 0 -2px 0 ${c}, 0 8px 28px rgba(0,0,0,0.5)`, word: c, wordShadow: undefined, status: '#cfd2da', chipBg: `${c}22`, chipText: c };
}

const ROSTER = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];

function DraftTop({ band, t }: { band: Band; t: T }) {
  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
      {/* colored band (word + controls + roster strip + status) */}
      <div style={{ background: band.bg, boxShadow: band.shadow }} className="px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-black uppercase" style={{ fontSize: 16, lineHeight: 1, letterSpacing: '0.14em', color: band.word, textShadow: band.wordShadow }}>
            {t === 'jackpot' ? 'JACKPOT' : 'HOF'}
          </span>
          <span className="ml-auto flex gap-1.5">
            {['← EXIT', 'MUTE 🎵', '✈️ OFF'].map(b => (
              <span key={b} className="text-[10px] px-1 py-0.5 rounded border" style={{ borderColor: 'rgba(255,255,255,0.35)', color: band.chipText }}>{b}</span>
            ))}
          </span>
        </div>
        {/* roster strip */}
        <div className="flex gap-2 overflow-x-auto">
          {ROSTER.map((p, i) => (
            <div key={i} className="flex-shrink-0 text-center" style={{ width: 46 }}>
              <div className="w-9 h-9 mx-auto rounded-full" style={{ background: band.chipBg, border: '1px solid rgba(255,255,255,0.18)' }} />
              <p className="mt-1 font-bold text-[10px]" style={{ color: band.chipText }}>{p}</p>
            </div>
          ))}
        </div>
        <p className="text-center uppercase text-[11px] font-bold mt-2" style={{ color: band.status }}>
          On the clock: CeeDee Lamb · Pick 12 / 150
        </p>
      </div>
      {/* board peek (where you pick) */}
      <div className="divide-y divide-white/[0.05]">
        {[['CeeDee Lamb', 'DAL WR', '4.2'], ['Bijan Robinson', 'ATL RB', '5.1'], ['Tyreek Hill', 'MIA WR', '6.0']].map(([n, pos, adp]) => (
          <div key={n} className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-white/[0.05]" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-[12px] font-semibold truncate">{n}</p>
              <p className="text-white/40 text-[10px]">{pos} · ADP {adp}</p>
            </div>
            <span className="text-[10px] font-bold text-black bg-banana rounded px-2 py-1">DRAFT</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ title, sub, treatment, rec }: { title: string; sub: string; treatment: 'current' | 'deep' | 'accent'; rec?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-white font-semibold text-[14px]">{title}</p>
        {rec && <span className="text-[10px] font-bold uppercase tracking-wide text-banana bg-banana/15 px-1.5 py-0.5 rounded">Rec</span>}
      </div>
      <p className="text-white/40 text-xs mb-3">{sub}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DraftTop band={bandFor(treatment, 'jackpot')} t="jackpot" />
        <DraftTop band={bandFor(treatment, 'hof')} t="hof" />
      </div>
    </div>
  );
}

export default function TestDraftTypeColors() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-4xl mx-auto space-y-9">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">In-draft Jackpot / HOF band — current vs options</h1>
          <p className="text-white/45 text-sm mt-1.5 leading-relaxed">
            This is the top band you see <b className="text-white/70">while drafting</b> — left = Jackpot, right = HOF.
            <b className="text-white/70"> Current</b> is the exact real band from the draft room (glossy red / metallic gold,
            holding your roster strip + the on-the-clock line). Options keep the same red/gold identity but cleaner.
          </p>
        </div>
        <Row title="Current (exact, live now)" sub="Glossy red / metallic gold band — vivid, can fight the board + cards below."
          treatment="current" />
        <Row title="Option A — Deep" rec
          sub="Same red/gold but deep → near-black; premium + restrained, text reads easily, stops shouting over the board."
          treatment="deep" />
        <Row title="Option B — Dark + accent" sub="Near-black band, color shown via a bottom accent line + the colored word. Most minimal/Apple, highest legibility."
          treatment="accent" />
        <p className="text-white/35 text-xs">
          My pick: <b className="text-white/60">Option A (Deep)</b> — keeps the unmistakable red/gold but tames the glare so
          the players + cards stay the focus. Tell me which and I&apos;ll wire it into <code>lib/draftBandStyle.ts</code> (one place → filling, reveal + drafting bands all update).
        </p>
      </div>
    </div>
  );
}
