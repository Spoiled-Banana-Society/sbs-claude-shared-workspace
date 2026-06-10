'use client';

// PRO draft-room styling mockups (Boris 2026-06-10) — pick one, then it ships.
// Also previews the NEW metallic header wordmark replacing the old
// jackpot-logo.png / hof-logo.jpg images in the draft-room banner.
// TEMP page — safe to delete once a direction is chosen.

import React from 'react';

const TYPES = {
  jackpot: {
    label: 'JACKPOT',
    edge: 'rgba(239,68,68,0.85)',
    gradient: 'linear-gradient(180deg, #FFE0E0 0%, #FF4D4D 35%, #B91C1C 70%, #FFC2C2 100%)',
    glow: 'rgba(239,68,68,0.95)',
    accent: '#ef4444',
    soft: 'rgba(239,68,68,0.12)',
  },
  hof: {
    label: 'HOF',
    edge: 'rgba(255,215,0,0.85)',
    gradient: 'linear-gradient(180deg, #FFF6C2 0%, #FFD700 30%, #B8860B 65%, #FFE57F 100%)',
    glow: 'rgba(255,215,0,0.95)',
    accent: '#D4AF37',
    soft: 'rgba(212,175,55,0.12)',
  },
  pro: {
    label: 'PRO',
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
      <div
        className="relative rounded-lg overflow-hidden"
        style={{
          background: '#0a0a0d',
          boxShadow: `inset 0 0 0 2px ${s.edge}`,
          padding: '14px 12px 18px',
        }}
      >
        {full && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at top, ${s.soft}, transparent 60%)` }}
          />
        )}
        {/* player boxes row */}
        <div className="relative flex gap-2 justify-center flex-wrap mb-4">
          <PlayerBox name="Boris Vagner" slot={1} you accent={full ? s.accent : '#F3E216'} tinted={full} />
          <PlayerBox name="Player 2" slot={2} accent={s.accent} />
          <PlayerBox name="Player 3" slot={3} accent={s.accent} />
          <PlayerBox name="---" slot={4} accent={s.accent} />
          <PlayerBox name="---" slot={5} accent={s.accent} />
        </div>
        {/* count + banner row (matches the draft-room bannerControls layout) */}
        <div className="relative text-center mb-2">
          <span className="text-[20px] font-black" style={{ color: full ? s.accent : '#fff' }}>3/10</span>
          <span className="text-[11px] text-white/50 font-semibold tracking-widest ml-2">WAITING FOR PLAYERS...</span>
        </div>
        <div
          className="relative flex items-center justify-center gap-3 py-2"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}
        >
          <Wordmark t={t} />
          <button className="text-[11px] text-white/70 border border-gray-500 px-1.5 py-0.5">← EXIT</button>
          <button className="text-[11px] text-white/70 border border-gray-500 px-1.5 py-0.5">MUTE 🎵</button>
          <button className="text-[11px] text-white/70 border border-gray-500 px-1.5 py-0.5">✈ OFF</button>
        </div>
        {/* tab strip hint */}
        <div className="relative flex justify-center gap-4 pt-3 text-[11px] font-bold">
          <span style={{ color: full ? s.accent : '#F3E216', border: `1px solid ${full ? s.accent : '#F3E216'}`, padding: '1px 8px', borderRadius: 4 }}>DRAFT</span>
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
      <h1 className="text-white text-xl font-bold mb-1">PRO draft styling — pick an option</h1>
      <p className="text-white/40 text-[13px] mb-8">
        All headers use the NEW metallic wordmark (replaces the old jackpot-logo.png / hof-logo.jpg images).
        Jackpot + HOF shown first for reference in the new style.
      </p>

      <RoomMock t="jackpot" full title="Reference — Jackpot (new metallic wordmark)" note="Same red edge + red treatment it has today, header logo image swapped for the metallic JACKPOT wordmark." />
      <RoomMock t="hof" full title="Reference — HOF (new metallic wordmark)" note="Gold edge + gold treatment, metallic HOF wordmark." />

      <div className="h-px bg-white/10 my-8" />

      <RoomMock t="pro" full={false} title="OPTION A — PRO: purple edge + wordmark only" note="Purple outer edge lines + metallic purple PRO in the header. Everything else stays the normal room (yellow accents)." />
      <RoomMock t="pro" full title="OPTION B — PRO: full purple treatment" note="Edge + wordmark + the same extras Jackpot/HOF get: purple count, purple glow wash, your box + active tab tinted purple." />
    </div>
  );
}
