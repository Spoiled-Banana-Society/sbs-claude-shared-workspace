'use client';

/**
 * Jackpot / HOF draft-type top band — current vs options (TEMP, safe to delete).
 * Live at /test-draft-type-colors. Shows the top part (type band + pick boxes)
 * the way it looks when a draft is revealed as Jackpot (red) or HOF (gold).
 */

const JP = '#ef4444';
const HOF = '#d4af37';

function Boxes({ accent }: { accent?: string }) {
  // A few pick slots under the band, like the draft board header.
  const slots = ['QB', 'RB', 'WR', 'TE'];
  return (
    <div className="grid grid-cols-4 gap-2 p-3">
      {slots.map((s) => (
        <div key={s} className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-2.5 text-center"
          style={accent ? { borderColor: `${accent}55` } : undefined}>
          <p className="text-white/40 text-[9px] uppercase tracking-wider">{s}</p>
          <p className="text-white/70 text-[11px] font-semibold mt-0.5">Pick</p>
        </div>
      ))}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl overflow-hidden border border-white/[0.07] bg-[#0c0c12]">{children}</div>;
}

// CURRENT — solid saturated band, big word.
function Current({ color, word }: { color: string; word: string }) {
  return (
    <Frame>
      <div className="py-3 px-4 text-center" style={{ background: color }}>
        <span className="font-extrabold tracking-wide text-[#1a1a1f] text-[15px]">{word}</span>
      </div>
      <Boxes />
    </Frame>
  );
}

// OPTION A — dark band, colored word + thin accent underline. Subtle/Apple.
function OptionA({ color, word }: { color: string; word: string }) {
  return (
    <Frame>
      <div className="py-3 px-4 text-center bg-[#141017]" style={{ boxShadow: `inset 0 -2px 0 ${color}` }}>
        <span className="font-extrabold tracking-[0.18em] text-[13px]" style={{ color }}>{word}</span>
      </div>
      <Boxes accent={color} />
    </Frame>
  );
}

// OPTION B — deep gradient band (color → near-black), white word, colored dot.
function OptionB({ color, word }: { color: string; word: string }) {
  return (
    <Frame>
      <div className="py-3 px-4 flex items-center justify-center gap-2"
        style={{ background: `linear-gradient(180deg, ${color}33 0%, rgba(12,12,18,0) 100%)` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="font-bold tracking-wide text-white text-[14px]">{word}</span>
      </div>
      <Boxes />
    </Frame>
  );
}

// OPTION C — neutral dark band with a filled colored pill chip.
function OptionC({ color, word }: { color: string; word: string }) {
  return (
    <Frame>
      <div className="py-3 px-4 text-center bg-[#101015]">
        <span className="inline-block rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide text-[#1a1a1f]"
          style={{ background: color }}>{word}</span>
      </div>
      <Boxes />
    </Frame>
  );
}

function Row({ title, sub, render, recommended }: {
  title: string; sub: string; recommended?: boolean;
  render: (color: string, word: string) => React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-white font-semibold text-[14px]">{title}</p>
        {recommended && <span className="text-[10px] font-bold uppercase tracking-wide text-banana bg-banana/15 px-1.5 py-0.5 rounded">Rec</span>}
      </div>
      <p className="text-white/40 text-xs mb-3">{sub}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {render(JP, 'JACKPOT')}
        {render(HOF, 'HALL OF FAME')}
      </div>
    </div>
  );
}

export default function TestDraftTypeColors() {
  return (
    <div className="min-h-screen bg-[#08090c] px-4 sm:px-8 py-10">
      <div className="max-w-4xl mx-auto space-y-9">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Jackpot / HOF draft band — current vs options</h1>
          <p className="text-white/45 text-sm mt-1.5 leading-relaxed">
            The top part of the draft when the type is revealed. Left = Jackpot (red <code className="text-white/60">#ef4444</code>),
            right = HOF (gold <code className="text-white/60">#d4af37</code>). Same colors throughout — only the treatment changes.
          </p>
        </div>
        <Row title="Current" sub="Solid saturated band, dark word — loud, can fight the cards below."
          render={(c, w) => <Current key={w} color={c} word={w} />} />
        <Row title="Option A — accent underline" recommended
          sub="Dark band, colored word + thin colored underline + faint colored box edges. Cleanest/Apple."
          render={(c, w) => <OptionA key={w} color={c} word={w} />} />
        <Row title="Option B — gradient fade"
          sub="Color fades from the top into the dark, white word + colored dot. Subtle depth."
          render={(c, w) => <OptionB key={w} color={c} word={w} />} />
        <Row title="Option C — pill chip"
          sub="Neutral dark band with a filled colored pill. Compact, very legible."
          render={(c, w) => <OptionC key={w} color={c} word={w} />} />
        <p className="text-white/35 text-xs">
          My pick: <b className="text-white/60">Option A</b> — keeps red/gold unmistakable but stops the band from
          shouting over the cards, and the faint colored box edges tie the type through the whole board. Tell me which
          and I&apos;ll wire it into the real draft room.
        </p>
      </div>
    </div>
  );
}
