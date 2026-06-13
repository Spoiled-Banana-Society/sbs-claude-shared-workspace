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
  topHighlight?: boolean;  // subtle glassy white highlight along the top edge
  wordShadow?: string;     // soft glow on the type word
  shadow?: string;         // full boxShadow override for depth
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
        boxShadow: v.shadow ?? (v.topHighlight
          ? 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.55), 0 8px 30px rgba(0,0,0,0.45)'
          : 'inset 0 -1px 0 rgba(0,0,0,0.45)'),
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
          <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: '0.18em', color: v.wordColor, textShadow: v.wordShadow }}>{v.word}</span>
          {['← EXIT', 'MUTE 🎵', '✈ OFF'].map(b => (
            <span key={b} style={{ fontSize: 12, border: '1px solid #888', padding: '1px 4px', color: v.statusColor ?? '#fff' }}>{b}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const JACKPOT: Variant[] = [
  { name: 'JP 1 · Current (live now — for reference)', band: 'linear-gradient(180deg,#C92B30 0%,#9E1F24 100%)', word: 'JACKPOT', wordColor: '#fff' },
  // ---- premium ----
  { name: 'JP 2 · Crimson Glass (radial spotlight + glass top)', band: 'radial-gradient(135% 130% at 50% -25%, #B22631 0%, #6F1620 52%, #3A0C12 100%)', word: 'JACKPOT', wordColor: '#fff', topHighlight: true, wordShadow: '0 1px 8px rgba(255,90,96,0.45)' },
  { name: 'JP 3 · Onyx Ruby (near-black, ruby glow behind word)', band: 'radial-gradient(120% 150% at 50% 120%, #7A1620 0%, #2A0A0E 45%, #0C0506 100%)', word: 'JACKPOT', wordColor: '#FF5A60', topHighlight: true, statusColor: '#E5C7C9', wordShadow: '0 0 14px rgba(255,60,70,0.6)' },
  { name: 'JP 4 · Bordeaux (desaturated wine, matte)', band: 'linear-gradient(180deg,#5A1C24 0%,#34111A 55%,#220A11 100%)', word: 'JACKPOT', wordColor: '#F4D2D6', topHighlight: true, wordShadow: '0 1px 6px rgba(0,0,0,0.5)' },
  { name: 'JP 5 · Carbon + Ruby accent (minimal, premium)', band: 'linear-gradient(180deg,#1A1416 0%,#0E0A0C 100%)', topAccent: '#D2303C', word: 'JACKPOT', wordColor: '#FF4E57', statusColor: '#CBB7B9', wordShadow: '0 0 12px rgba(210,48,60,0.55)' },
  { name: 'JP 6 · Sunset Ember (warm depth)', band: 'radial-gradient(120% 130% at 50% -10%, #C33A2E 0%, #8A1F1C 50%, #2C0A0A 100%)', word: 'JACKPOT', wordColor: '#FFE3DC', topHighlight: true, wordShadow: '0 1px 8px rgba(0,0,0,0.45)' },
  { name: 'JP 7 · Velvet (deep, soft, luxurious)', band: 'linear-gradient(180deg,#4E1218 0%,#2A0A0F 60%,#180609 100%)', word: 'JACKPOT', wordColor: '#FF6B70', topHighlight: true, wordShadow: '0 0 10px rgba(255,80,86,0.4)' },
  { name: 'JP 8 · Obsidian Glass (almost black, red sheen)', band: 'linear-gradient(180deg,#241015 0%,#140A0D 45%,#0A0608 100%)', topAccent: 'rgba(226,72,82,0.55)', word: 'JACKPOT', wordColor: '#FF565E', statusColor: '#C9B6B8', topHighlight: true, wordShadow: '0 0 16px rgba(226,72,82,0.5)' },
];

const HOF: Variant[] = [
  { name: 'HOF 1 · Current (live now — for reference)', band: 'linear-gradient(180deg,#D2AB2C 0%,#B08F1F 100%)', word: 'HOF', wordColor: '#1a1400' },
  // ---- premium ----
  { name: 'HOF 2 · Champagne Glass (radial spotlight + glass top)', band: 'radial-gradient(135% 130% at 50% -25%, #E7CF87 0%, #C2A04E 52%, #8C6E2C 100%)', word: 'HOF', wordColor: '#2A1F00', topHighlight: true, wordShadow: '0 1px 6px rgba(255,255,255,0.25)' },
  { name: 'HOF 3 · Onyx Gold (near-black, gold glow behind word)', band: 'radial-gradient(120% 150% at 50% 120%, #8A6E28 0%, #2A2208 45%, #0C0A03 100%)', word: 'HOF', wordColor: '#F0CE73', topHighlight: true, statusColor: '#D8C79A', wordShadow: '0 0 14px rgba(232,199,102,0.55)' },
  { name: 'HOF 4 · Antique Gold (desaturated, matte heritage)', band: 'linear-gradient(180deg,#A8852F 0%,#7A5E1E 55%,#574214 100%)', word: 'HOF', wordColor: '#241B00', topHighlight: true, wordShadow: '0 1px 6px rgba(0,0,0,0.35)' },
  { name: 'HOF 5 · Carbon + Gold accent (minimal, premium)', band: 'linear-gradient(180deg,#17150E 0%,#0C0A06 100%)', topAccent: '#E8C766', word: 'HOF', wordColor: '#F0CE73', statusColor: '#CBC09A', wordShadow: '0 0 12px rgba(232,199,102,0.5)' },
  { name: 'HOF 6 · Brushed Gold (metallic, multi-stop sheen)', band: 'linear-gradient(180deg,#E0C06A 0%,#C6A24C 40%,#9E7C2E 75%,#7E6020 100%)', word: 'HOF', wordColor: '#2A1F00', topHighlight: true, wordShadow: '0 1px 6px rgba(255,255,255,0.3)' },
  { name: 'HOF 7 · Royal (warm radial depth)', band: 'radial-gradient(120% 130% at 50% -10%, #E6C56E 0%, #B8902A 50%, #4A380E 100%)', word: 'HOF', wordColor: '#2A1F00', topHighlight: true, wordShadow: '0 1px 8px rgba(255,255,255,0.2)' },
  { name: 'HOF 8 · Obsidian Glass (almost black, gold sheen)', band: 'linear-gradient(180deg,#1E1A0E 0%,#120F08 45%,#0A0804 100%)', topAccent: 'rgba(232,199,102,0.55)', word: 'HOF', wordColor: '#F0CE73', statusColor: '#CBC09A', topHighlight: true, wordShadow: '0 0 16px rgba(232,199,102,0.5)' },
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
