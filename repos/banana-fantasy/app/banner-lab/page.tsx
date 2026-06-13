'use client';

/* LOCAL-ONLY preview — compare Jackpot / HOF banner color treatments.
   Not linked anywhere; delete before shipping. Renders the real draft-room
   band markup (boxes, avatars, position bars, timer, type word) so colors
   can be judged in context. Visit /banner-lab on the dev server. */

import React from 'react';

const POS = { QB: '#FF474C', RB: '#3c9120', WR: '#cb6ce6', TE: '#326cf8', DST: '#DF893E' } as const;
const POSES = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;

type Variant = {
  name: string;
  band: string;            // band background (gradient or color)
  word: string;            // PRO/JACKPOT/HOF
  wordColor: string;
  topAccent?: string;      // optional thin top accent line color (premium/minimal looks)
  statusColor?: string;    // status-line text color
};

// One draft "box" — matches the real band box styling.
function Box({ kind, name, you, picked, pos, round, pick, timer }: {
  kind: 'you' | 'picked' | 'upcoming';
  name: string; you?: boolean; picked?: string; pos?: keyof typeof POS;
  round?: number; pick?: number; timer?: string;
}) {
  const borderColor = you ? '#F3E216' : kind === 'you' ? '#fff' : '#444';
  return (
    <div style={{
      minWidth: 'clamp(100px, 12vw, 140px)', flex: 1, padding: '10px 0 0 0',
      borderRadius: 5, borderWidth: 1, borderStyle: 'solid', borderColor,
      background: '#222', textAlign: 'center', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/banana-profile.png" alt="" width={48} height={48}
        style={{ borderRadius: '50%', margin: '0 auto', display: 'block',
          border: you ? '2px solid #F3E216' : '1px solid #1a1a2e' }} />
      <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12, color: you ? '#F3E216' : '#fff' }}>{name}</div>
      {timer ? (
        <div style={{ fontWeight: 'bold', fontSize: 16, margin: '2px auto 0', color: '#fff' }}>{timer}</div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 2, paddingBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', opacity: 0.7 }}>R{round}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', opacity: 0.7 }}>P{pick}</span>
        </div>
      )}
      {kind === 'picked' && pos ? (
        <div style={{ borderBottom: `5px solid ${POS[pos]}`, height: 55 }}>
          <p style={{ fontWeight: 800, fontSize: 15, paddingTop: 5, color: '#fff' }}>{picked}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 54, color: '#fff' }}>
          {POSES.map(p => (
            <div key={p} style={{ flex: 1, borderTop: `2px solid ${POS[p]}`, textAlign: 'center' }}>
              <p style={{ fontSize: 10 }}>{p}</p>
              <p style={{ fontSize: 12 }}>0</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Band({ v }: { v: Variant }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ color: '#888', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>
        {v.name}
      </div>
      <div style={{
        width: '100%', overflow: 'hidden', fontFamily: 'Montserrat, Arial, sans-serif',
        background: v.band,
        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.45)',
        borderTop: v.topAccent ? `2px solid ${v.topAccent}` : undefined,
        borderRadius: 6,
      }}>
        <div style={{ width: '100%', display: 'flex', gap: 8, overflowX: 'auto', marginTop: 15, padding: '0 8px' }}>
          <Box kind="you" you name="BananaKing99" timer="00:13" />
          <Box kind="picked" name="Banana4821" picked="DAL-WR1" pos="WR" round={1} pick={2} />
          <Box kind="picked" name="Banana9981" picked="SF-RB1" pos="RB" round={1} pick={3} />
          <Box kind="upcoming" name="Banana3120" round={1} pick={4} />
          <Box kind="upcoming" name="Banana6482" round={1} pick={5} />
          <Box kind="upcoming" name="Banana7705" round={1} pick={6} />
          <Box kind="upcoming" name="Banana1099" round={1} pick={7} />
          <Box kind="upcoming" name="Banana2210" round={1} pick={8} />
        </div>
        <div style={{ textAlign: 'center', textTransform: 'uppercase', fontSize: 14, fontWeight: 'bold', padding: '8px 12px', marginTop: 12, color: v.statusColor ?? '#fff' }}>
          1 turn until your pick!
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 10 }}>
          <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: '0.14em', color: v.wordColor }}>{v.word}</span>
          {['← EXIT', 'MUTE 🎵', '✈ OFF'].map(b => (
            <span key={b} style={{ fontSize: 12, border: '1px solid #888', padding: '1px 4px', color: v.statusColor ?? '#fff' }}>{b}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const JACKPOT: Variant[] = [
  { name: 'JP 1 · Current (live now)', band: 'linear-gradient(180deg,#C92B30 0%,#9E1F24 100%)', word: 'JACKPOT', wordColor: '#fff' },
  { name: 'JP 2 · Deep Crimson (darker, richer)', band: 'linear-gradient(180deg,#7E1419 0%,#4A0C10 100%)', word: 'JACKPOT', wordColor: '#FFD9DB' },
  { name: 'JP 3 · Clean Apple Red', band: 'linear-gradient(180deg,#C42833 0%,#9B1B22 100%)', word: 'JACKPOT', wordColor: '#fff' },
  { name: 'JP 4 · Ember (premium, near-black + red accent)', band: 'linear-gradient(180deg,#360D10 0%,#160506 100%)', topAccent: '#E0303A', word: 'JACKPOT', wordColor: '#FF5A60', statusColor: '#E9C9CB' },
  { name: 'JP 5 · Matte Oxblood', band: 'linear-gradient(180deg,#5E1115 0%,#360A0D 100%)', word: 'JACKPOT', wordColor: '#FF6B70' },
];

const HOF: Variant[] = [
  { name: 'HOF 1 · Current (live now)', band: 'linear-gradient(180deg,#D2AB2C 0%,#B08F1F 100%)', word: 'HOF', wordColor: '#1a1400' },
  { name: 'HOF 2 · Rich Gold (deeper)', band: 'linear-gradient(180deg,#B8902A 0%,#7E6212 100%)', word: 'HOF', wordColor: '#211900' },
  { name: 'HOF 3 · Champagne (clean, lighter premium)', band: 'linear-gradient(180deg,#E3C66E 0%,#C29A3C 100%)', word: 'HOF', wordColor: '#2A1F00' },
  { name: 'HOF 4 · Black Gold (premium, near-black + gold accent)', band: 'linear-gradient(180deg,#1E1808 0%,#0E0A02 100%)', topAccent: '#E8C766', word: 'HOF', wordColor: '#F0CE73', statusColor: '#D8C79A' },
  { name: 'HOF 5 · Metallic Gold (sheen)', band: 'linear-gradient(180deg,#E8CE7A 0%,#C5A24A 45%,#A07E2E 100%)', word: 'HOF', wordColor: '#2A1F00' },
];

export default function BannerLab() {
  return (
    <div style={{ background: '#000', minHeight: '100vh', padding: '28px 16px 80px', fontFamily: 'Montserrat, Arial, sans-serif' }}>
      <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Banner Lab — pick a treatment</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 28 }}>
        Real draft-room band with boxes. Each block is one color option. Tell me which JP # and HOF # you like (or mix-and-match) and I&apos;ll apply it.
      </p>
      <h2 style={{ color: '#ff5a60', fontSize: 16, fontWeight: 800, margin: '8px 0 16px' }}>JACKPOT (red)</h2>
      {JACKPOT.map(v => <Band key={v.name} v={v} />)}
      <h2 style={{ color: '#E8C766', fontSize: 16, fontWeight: 800, margin: '32px 0 16px' }}>HALL OF FAME (gold)</h2>
      {HOF.map(v => <Band key={v.name} v={v} />)}
    </div>
  );
}
