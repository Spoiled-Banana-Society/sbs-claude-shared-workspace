'use client';

// PRO draft-room styling mockups (Boris 2026-06-10) — pick one, then it ships.
// Also previews the NEW metallic header wordmark replacing the old
// jackpot-logo.png / hof-logo.jpg images in the draft-room banner.
// TEMP page — safe to delete once a direction is chosen.

import React from 'react';

const TYPES = {
  jackpot: {
    label: 'JACKPOT',
    band: '#C0282D', // EXACT band color the real room uses
    edge: 'rgba(239,68,68,0.85)',
    gradient: 'linear-gradient(180deg, #FFE0E0 0%, #FF4D4D 35%, #B91C1C 70%, #FFC2C2 100%)',
    glow: 'rgba(239,68,68,0.95)',
    accent: '#ef4444',
    soft: 'rgba(239,68,68,0.12)',
  },
  hof: {
    label: 'HOF',
    band: '#C9A227', // EXACT band color the real room uses
    edge: 'rgba(255,215,0,0.85)',
    gradient: 'linear-gradient(180deg, #FFF6C2 0%, #FFD700 30%, #B8860B 65%, #FFE57F 100%)',
    glow: 'rgba(255,215,0,0.95)',
    accent: '#D4AF37',
    soft: 'rgba(212,175,55,0.12)',
  },
  pro: {
    label: 'PRO',
    band: '#6D28D9', // proposed purple band — same depth as the JP/HOF tones
    edge: 'rgba(168,85,247,0.85)',
    gradient: 'linear-gradient(180deg, #F0DFFF 0%, #C084FC 30%, #7E22CE 65%, #E1C6FF 100%)',
    glow: 'rgba(168,85,247,0.95)',
    accent: '#a855f7',
    soft: 'rgba(168,85,247,0.12)',
  },
} as const;

type TypeKey = keyof typeof TYPES;

function Wordmark({ t, size = 26 }: { t: TypeKey; size?: number }) {
  const s = TYPES[t];
  return (
    <span
      className="font-black italic tracking-tighter"
      style={{
        fontSize: size,
        lineHeight: 1,
        background: s.gradient,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter: `drop-shadow(0 0 10px ${s.glow})`,
      }}
    >
      {s.label}
    </span>
  );
}

function PlayerBox({ name, slot, you, accent, tinted }: { name: string; slot: number; you?: boolean; accent: string; tinted?: boolean }) {
  return (
    <div
      className="rounded-md px-2 py-2 text-center"
      style={{
        width: 86,
        border: you ? `2px solid ${accent}` : '1px solid #3a3a40',
        background: you && tinted ? `${accent}22` : '#141417',
        boxShadow: you ? `0 0 12px ${accent}55` : undefined,
      }}
    >
      <div className="w-7 h-7 mx-auto mb-1 rounded-full bg-[#23232a] flex items-center justify-center text-[13px]">🍌</div>
      <div className="text-[10px] text-white font-semibold truncate">{name}</div>
      <div className="text-[9px] text-white/40">#{slot}</div>
    </div>
  );
}

/** A miniature draft-room shell: edge frame + banner + count + boxes. */
function RoomMock({
  t,
  full,
  title,
  note,
}: {
  t: TypeKey;
  full: boolean; // false = edge + wordmark only; true = full color treatment
  title: string;
  note: string;
}) {
  const s = TYPES[t];
  return (
    <div className="mb-10">
      <h2 className="text-banana text-[15px] font-semibold mb-1">{title}</h2>
      <p className="text-white/40 text-[12px] mb-3">{note}</p>
      <div className="relative rounded-lg overflow-hidden" style={{ background: '#000' }}>
        {/* Type-colored BAND behind the strip — same structure as the real
            room: band covers boxes + count + banner; content below is black. */}
        <div style={{ background: full ? s.band : '#000', padding: '14px 12px 10px' }}>
          <div className="relative flex gap-2 justify-center flex-wrap mb-4">
            <PlayerBox name="Boris Vagner" slot={1} you accent="#F3E216" />
            <PlayerBox name="Player 2" slot={2} accent={s.accent} />
            <PlayerBox name="Player 3" slot={3} accent={s.accent} />
            <PlayerBox name="---" slot={4} accent={s.accent} />
            <PlayerBox name="---" slot={5} accent={s.accent} />
          </div>
          <div className="relative text-center mb-2">
            <span className="text-[20px] font-black" style={{ color: '#F3E216' }}>3/10</span>
            <span className="text-[11px] font-semibold tracking-widest ml-2" style={{ color: full ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)' }}>WAITING FOR PLAYERS...</span>
          </div>
          <div className="relative flex items-center justify-center gap-3 py-2">
            <Wordmark t={t} />
            <button className="text-[11px] text-white/80 border border-gray-400 px-1.5 py-0.5">← EXIT</button>
            <button className="text-[11px] text-white/80 border border-gray-400 px-1.5 py-0.5">MUTE 🎵</button>
            <button className="text-[11px] text-white/80 border border-gray-400 px-1.5 py-0.5">✈ OFF</button>
          </div>
        </div>
        {/* page edge (the thin pulsing 2px frame the real room shows) */}
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 0 2px ${s.edge}` }} />
        {/* tab strip hint on black, like the real room */}
        <div className="relative flex justify-center gap-4 py-3 text-[11px] font-bold" style={{ background: '#000' }}>
          <span style={{ color: '#F3E216', border: '1px solid #F3E216', padding: '1px 8px', borderRadius: 4 }}>DRAFT</span>
          <span className="text-white/60">QUEUE</span>
          <span className="text-white/60">BOARD</span>
          <span className="text-white/60">ROSTER</span>
          <span className="text-white/60">CHAT</span>
        </div>
      </div>
    </div>
  );
}

export default function TestDraftStyle() {
  return (
    <div style={{ background: '#060608', minHeight: '100vh', padding: '28px 18px', maxWidth: 1100, margin: '0 auto' }}>
      <h1 className="text-white text-xl font-bold mb-1">Draft room styling</h1>
      <p className="text-white/40 text-[13px] mb-8">
        Section 1: REAL screenshots of the Jackpot + HOF rooms as deployed right now (lobby + drafting).
        Section 2: the PRO options to pick from, drawn in the exact same structure.
      </p>

      <h2 className="text-banana text-[16px] font-bold mb-3">1 · REAL deployed Jackpot + HOF (screenshots, not mockups)</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {([
          ['/style-preview/jackpot-lobby.png', 'Jackpot — lobby (filling)'],
          ['/style-preview/hof-lobby.png', 'HOF — lobby (filling)'],
          ['/style-preview/jackpot-drafting.png', 'Jackpot — drafting'],
          ['/style-preview/hof-drafting.png', 'HOF — drafting'],
        ] as const).map(([src, cap]) => (
          <figure key={src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={cap} className="rounded-lg border border-white/10 w-full" />
            <figcaption className="text-white/40 text-[11px] mt-1">{cap}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-white/35 text-[12px] mb-8">
        Note: the small JACKPOT / HOF logo image in the banner is still the OLD asset — the metallic
        wordmark below is the proposed replacement. Say the word and I swap it in all rooms.
      </p>

      <div className="h-px bg-white/10 my-8" />

      <h2 className="text-banana text-[16px] font-bold mb-3">2 · PRO options (same structure as the real rooms above)</h2>
      <RoomMock t="jackpot" full title="Reference — Jackpot with metallic wordmark" note="Exact band red (#C0282D) the real room uses; logo image swapped for the metallic JACKPOT wordmark." />
      <RoomMock t="hof" full title="Reference — HOF with metallic wordmark" note="Exact band gold (#C9A227); metallic HOF wordmark." />

      <div className="h-px bg-white/10 my-8" />

      <RoomMock t="pro" full={false} title="OPTION A — PRO: purple edge + wordmark only" note="Purple outer edge + metallic purple PRO wordmark. NO band — the strip stays black like today's pro rooms." />
      <RoomMock t="pro" full title="OPTION B — PRO: full purple treatment" note="Same treatment JP/HOF get: deep-purple band behind the boxes + purple edge + PRO wordmark." />
    </div>
  );
}
