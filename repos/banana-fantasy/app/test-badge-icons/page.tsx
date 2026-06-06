'use client';

// Temporary design-exploration page: every badge redrawn with a clean Lucide
// icon, in 3 disc styles. Public route so it can be screenshotted. Safe to delete.

import {
  Sprout, Swords, Flame, Medal, Crown, Coins, Landmark, Flag, Star, Target,
  Trophy, Sparkles, FerrisWheel, Gem, Zap, Ticket,
} from 'lucide-react';
import type { ComponentType } from 'react';

type IconC = ComponentType<any>;

interface B { id: string; label: string; color: string; Icon?: IconC; num?: string; champ?: boolean; }

const BADGES: B[] = [
  { id: 'first-draft', label: 'First Draft', color: '#84cc16', Icon: Sprout },
  { id: 'drafts-20', label: 'Veteran', color: '#3b82f6', Icon: Swords },
  { id: 'drafts-50', label: 'Grinder', color: '#6366f1', Icon: Flame },
  { id: 'drafts-100', label: 'Centurion', color: '#a855f7', Icon: Medal },
  { id: 'pro-win', label: 'Pro League Winner', color: '#a855f7', Icon: Crown },
  { id: 'jp-win', label: 'Jackpot League Winner', color: '#ef4444', Icon: Coins },
  { id: 'hof-win', label: 'HOF League Winner', color: '#D4AF37', Icon: Landmark },
  { id: 'playoffs', label: 'Playoff Bound', color: '#22c55e', Icon: Flag },
  { id: 'week-win', label: 'Week Champion', color: '#fbbf24', Icon: Star },
  { id: 'finalist', label: 'Finalist', color: '#facc15', Icon: Target },
  { id: 'bbb-bronze', label: 'BBB Bronze', color: '#cd7f32', Icon: Medal },
  { id: 'bbb-silver', label: 'BBB Silver', color: '#c0c0c0', Icon: Medal },
  { id: 'bbb-champion', label: 'BBB Champion', color: '#ffd700', Icon: Trophy },
  { id: 'hof-bronze', label: 'HOF Bronze', color: '#D4AF37', Icon: Medal },
  { id: 'hof-silver', label: 'HOF Silver', color: '#D4AF37', Icon: Medal },
  { id: 'hof-champion', label: 'HOF Champion', color: '#D4AF37', Icon: Sparkles },
  { id: 'first-spin', label: 'First Spin', color: '#94a3b8', Icon: FerrisWheel },
  { id: 'spin-jp', label: 'Lucky Spin (JP)', color: '#ef4444', Icon: Gem },
  { id: 'spin-hof', label: 'Lucky Spin (HOF)', color: '#D4AF37', Icon: Coins },
  { id: 'beat-founder', label: 'Beat the Founder', color: '#06b6d4', Icon: Zap },
  { id: 'founder-pick', label: "Founder's Pick", color: '#06b6d4', Icon: Ticket },
  { id: 'bbb4', label: 'BBB4 Participant', color: '#fbbf24', num: '4' },
  { id: 'bbb1', label: 'BBB1 Participant', color: '#22c55e', num: '1' },
  { id: 'bbb2', label: 'BBB2 Participant', color: '#3b82f6', num: '2' },
  { id: 'bbb3', label: 'BBB3 Participant', color: '#ec4899', num: '3' },
  { id: 'bbb1-champ', label: 'BBB1 Champion', color: '#ffd700', num: '1', champ: true },
  { id: 'bbb2-champ', label: 'BBB2 Champion', color: '#ffd700', num: '2', champ: true },
  { id: 'bbb3-champ', label: 'BBB3 Champion', color: '#ffd700', num: '3', champ: true },
  { id: 'bbb1-hof-champ', label: 'BBB1 HOF Champion', color: '#D4AF37', num: '1', champ: true },
  { id: 'bbb2-hof-champ', label: 'BBB2 HOF Champion', color: '#D4AF37', num: '2', champ: true },
  { id: 'bbb3-hof-champ', label: 'BBB3 HOF Champion', color: '#D4AF37', num: '3', champ: true },
];

const TEAMS = [
  { code: 'KC', color: '#E31837' }, { code: 'SF', color: '#AA0000' },
  { code: 'DAL', color: '#041E42' }, { code: 'PHI', color: '#004C54' },
];

const SIZE = 60;

function Disc({ b, mode }: { b: B; mode: 'premium' | 'solid' | 'tinted' }) {
  const s = SIZE;
  const iconSize = Math.round(s * 0.5);
  let bg = '', border = '', iconColor = '#fff';
  if (mode === 'premium') { bg = '#161616'; border = `1.5px solid ${b.color}`; iconColor = b.color; }
  else if (mode === 'solid') { bg = b.color; border = 'none'; iconColor = '#fff'; }
  else { bg = `${b.color}22`; border = `1.5px solid ${b.color}`; iconColor = b.color; }
  const Icon = b.Icon;
  return (
    <div style={{ width: s, height: s, borderRadius: 9999, background: bg, border,
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      boxShadow: mode === 'premium' ? `0 0 0 0.5px rgba(255,255,255,0.06)` : 'none' }}>
      {Icon ? <Icon size={iconSize} color={iconColor} strokeWidth={2} />
        : <span style={{ fontWeight: 800, fontSize: Math.round(s * 0.42), color: iconColor }}>{b.num}</span>}
      {b.champ && <Crown size={Math.round(s * 0.28)} color={iconColor} fill={iconColor}
        style={{ position: 'absolute', top: -Math.round(s * 0.12), left: '50%', transform: 'translateX(-50%)' }} />}
    </div>
  );
}

export default function TestBadgeIcons() {
  return (
    <div style={{ background: '#0b0b0b', minHeight: '100vh', padding: 36, color: '#fff', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Every badge — redrawn clean (Lucide icons)</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, maxWidth: 820 }}>
        Three disc styles per badge. <b>Premium</b> = dark + thin colored ring (matches your new draft pass).
        <b> Solid</b> = filled color + white icon. <b>Tinted</b> = soft fill + colored icon.
      </p>
      {(['premium', 'solid', 'tinted'] as const).map(mode => (
        <div key={mode} style={{ marginTop: 26 }}>
          <div style={{ fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 13, marginBottom: 12 }}>{mode}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
            {BADGES.map(b => (
              <div key={b.id} style={{ width: 92, textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}><Disc b={b} mode={mode} /></div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, lineHeight: 1.3 }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 34 }}>
        <div style={{ fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 13, marginBottom: 12 }}>NFL teams — logo vs clean abbreviation</div>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          {TEAMS.map(t => (
            <div key={t.code} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: SIZE, height: SIZE, borderRadius: 9999, background: `${t.color}22`, border: `1.5px solid ${t.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://a.espncdn.com/i/teamlogos/nfl/500/${t.code.toLowerCase()}.png`} width={Math.round(SIZE * 0.78)} height={Math.round(SIZE * 0.78)} alt="" />
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>logo</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: SIZE, height: SIZE, borderRadius: 9999, background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: t.code.length >= 3 ? 16 : 20, color: '#fff' }}>{t.code}</span>
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>abbrev</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
