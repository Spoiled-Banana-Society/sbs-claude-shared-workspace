'use client';

import React from 'react';

/**
 * Obsidian NFT card — single source of truth for the in-app render of both:
 *  - the post-draft TEAM card (tier-colored foil frame + roster)
 *  - the pre-reveal grey DRAFT PASS  (`preReveal`)
 *
 * Locked designs: ~/Desktop/premium-obsidian-v13.html (team) and
 * ~/Desktop/obsidian-draftpass-v4.html (grey pass). The 1080x1350 (4:5) NFT
 * PNG is produced separately by /api/og/team-card using the same design.
 *
 * Rendered at a fixed 312x452 design size and CSS-scaled to `width` so it is
 * pixel-faithful at any display size (generating screen, roster page, etc.).
 */

export type CardTier = 'pro' | 'hof' | 'jackpot';

export interface CardPlayer {
  team: string;            // "BAL"
  pos: string;             // "QB" | "RB1" | "WR1" | "TE" | "DST"
  bye: number | string;
  adp: number | string;
  pick: number | string;
}

interface Props {
  tier?: CardTier;
  players?: CardPlayer[];
  passNumber?: string | number | null;
  /** Renders the grey pre-reveal draft pass instead of the team card. */
  preReveal?: boolean;
  /** Generating-screen animation: rows with index < revealCount are visible. */
  revealCount?: number;
  /** Display width in px (design is 312 wide card / 320 with frame). */
  width?: number;
  className?: string;
}

// Frame foil gradients (from locked mockups).
const FRAME: Record<CardTier, string> = {
  pro: 'linear-gradient(135deg,#6b21a8,#d8b4fe 30%,#a855f7 52%,#f3e8ff 64%,#7e22ce 84%,#c084fc)',
  hof: 'linear-gradient(135deg,#7c5a14,#ffe9a0 22%,#d9b53c 44%,#fff6cf 58%,#b8901f 80%,#f0d875)',
  jackpot: 'linear-gradient(135deg,#7e1316,#ff8a85 24%,#e23b3b 46%,#ffd9d4 58%,#b01c1c 80%,#ef5350)',
};
const GREY_FRAME = 'linear-gradient(135deg,#23262d,#aab0bb 22%,#474d58 44%,#dfe4ec 58%,#3a3f48 80%,#878e99)';

const BADGE: Record<CardTier, { text: string; bg: string; line: string; dot: string; label: string }> = {
  pro: { text: '#c79bff', bg: 'rgba(168,85,247,.16)', line: 'rgba(168,85,247,.5)', dot: '#b87cff', label: 'PRO' },
  hof: { text: '#f3d057', bg: 'rgba(225,200,75,.14)', line: 'rgba(225,200,75,.5)', dot: '#f1c84b', label: 'HOF' },
  jackpot: { text: '#ff7b7b', bg: 'rgba(239,68,68,.16)', line: 'rgba(239,68,68,.5)', dot: '#ff5a5a', label: 'JACKPOT' },
};

// On-dark position colors — brightened variants of the canonical
// POSITION_COLORS in lib/draftRoomConstants.ts (QB red / RB green / WR purple /
// TE blue / DST orange), tuned for contrast on the obsidian body.
const POS_ON_DARK: Record<string, string> = {
  QB: '#ff5a5f', RB: '#69c93f', WR: '#d98cf0', TE: '#5b8cff', DST: '#f0a050',
};
const basePos = (p: string) => p.replace(/[0-9]/g, '').toUpperCase();
export const posColorOnDark = (pos: string) => POS_ON_DARK[basePos(pos)] || '#9aa0ab';

const DESIGN_W = 320; // card (312) + 4px frame each side
const DESIGN_H = 460; // card (452) + 4px frame each side

export default function TeamCardObsidian({
  tier = 'pro',
  players = [],
  passNumber,
  preReveal = false,
  revealCount,
  width = 312,
  className,
}: Props) {
  const scale = width / DESIGN_W;
  const shownThrough = revealCount == null ? players.length : revealCount;
  const passNo = passNumber != null && passNumber !== '' ? `#${passNumber}` : '';

  return (
    <div className={className} style={{ width, height: DESIGN_H * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: DESIGN_W, height: DESIGN_H }}>
        <div className="tco-frame" style={{ background: preReveal ? GREY_FRAME : FRAME[tier] }}>
          <div className="tco-card">
            {preReveal ? (
              <>
                <div className="tco-perf" />
                <div className="tco-pad tco-pad-pass">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="tco-logo tco-logo-pass" src="/sbs-logo-white.png" alt="SBS" />
                  <div className="tco-dp">DRAFT PASS {passNo}</div>
                  <div className="tco-passtitle">
                    <div className="tco-bb">BANANA<br />BEST BALL</div>
                    <div className="tco-iv">IV</div>
                  </div>
                  <div className="tco-foot tco-foot-pass">SBS</div>
                </div>
                <span className="tco-notch tco-notch-l" />
                <span className="tco-notch tco-notch-r" />
              </>
            ) : (
              <div className="tco-pad">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="tco-logo" src="/sbs-logo-white.png" alt="SBS" />
                <div className="tco-title">BANANA BEST BALL IV</div>
                <div className="tco-badge" style={{ color: BADGE[tier].text, background: BADGE[tier].bg, boxShadow: `0 0 0 1px ${BADGE[tier].line} inset` }}>
                  <span className="tco-dot" style={{ background: BADGE[tier].dot }} />
                  {BADGE[tier].label}
                </div>
                <div className="tco-colh">
                  <span className="tco-name" />
                  <span className="tco-c">BYE</span>
                  <span className="tco-c">ADP</span>
                  <span className="tco-c">PICK</span>
                </div>
                <div className="tco-rule" />
                <div className="tco-roster">
                  {players.slice(0, 15).map((p, i) => {
                    const shown = i < shownThrough;
                    return (
                      <div
                        key={`${p.team}-${p.pos}-${i}`}
                        className="tco-row"
                        style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(3px)' }}
                      >
                        <div className="tco-name">
                          <span className="tco-tm">{p.team}</span>
                          <span className="tco-ps" style={{ color: posColorOnDark(p.pos) }}>{p.pos}</span>
                        </div>
                        <span className="tco-stat">{p.bye}</span>
                        <span className="tco-stat">{p.adp}</span>
                        <span className="tco-stat">#{p.pick}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="tco-foot">SBS</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .tco-frame { padding: 4px; border-radius: 28px; box-shadow: 0 40px 80px -30px rgba(0,0,0,.95); }
        .tco-card {
          width: 312px; height: 452px; border-radius: 23px; position: relative; overflow: hidden;
          background: linear-gradient(172deg,#17171e 0%,#0d0d12 58%,#070709 100%);
        }
        .tco-pad { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; padding: 14px 16px 15px; align-items: center; }
        .tco-logo { width: 26px; height: 26px; object-fit: contain; opacity: .92; filter: drop-shadow(0 1px 3px rgba(0,0,0,.55)); }
        .tco-title { margin-top: 5px; font-size: 12px; font-weight: 700; letter-spacing: .6px; color: rgba(255,255,255,.85); }
        .tco-badge { margin-top: 7px; display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px; border-radius: 30px; font-size: 11px; font-weight: 900; letter-spacing: 1.5px; }
        .tco-dot { width: 5px; height: 5px; border-radius: 50%; }
        .tco-colh { display: flex; justify-content: center; align-items: flex-end; margin-top: 13px; }
        .tco-colh .tco-name { width: 104px; }
        .tco-c { width: 30px; margin-left: 8px; text-align: center; font-size: 7px; font-weight: 800; letter-spacing: 1.2px; color: rgba(255,255,255,.26); }
        .tco-rule { width: 88%; height: 1px; background: linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent); margin-top: 4px; }
        .tco-roster { width: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 4px 0 2px; }
        .tco-row { display: flex; justify-content: center; align-items: baseline; flex: 1; border-bottom: 1px solid rgba(255,255,255,.05); transition: opacity .45s ease, transform .45s ease; }
        .tco-row:last-child { border-bottom: none; }
        .tco-name { width: 104px; text-align: center; white-space: nowrap; }
        .tco-tm { font-size: 15px; font-weight: 700; color: #fff; letter-spacing: .2px; }
        .tco-ps { font-size: 15px; font-weight: 800; letter-spacing: .2px; margin-left: 6px; }
        .tco-stat { width: 30px; margin-left: 8px; text-align: center; font-size: 9px; font-weight: 600; color: rgba(255,255,255,.4); font-variant-numeric: tabular-nums; }
        .tco-foot { margin-top: 13px; margin-bottom: 2px; font-size: 10.5px; font-weight: 800; letter-spacing: .6px; color: rgba(255,255,255,.55); }

        /* ---- pre-reveal grey pass ---- */
        .tco-perf { position: absolute; inset: 11px; border: 1.5px dashed rgba(255,255,255,.20); border-radius: 15px; pointer-events: none; }
        .tco-pad-pass { justify-content: flex-start; padding: 32px 24px 26px; text-align: center; }
        .tco-logo-pass { width: 42px; height: 42px; opacity: 1; }
        .tco-dp { margin-top: 16px; font-size: 13.5px; font-weight: 800; letter-spacing: 3.5px; color: rgba(255,255,255,.9); }
        .tco-passtitle { margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .tco-bb { font-style: italic; font-weight: 800; font-size: 30px; line-height: 1.05; letter-spacing: .3px; color: #fbbf24; }
        .tco-iv { font-style: italic; font-weight: 800; font-size: 38px; line-height: 1; color: #fbbf24; }
        .tco-foot-pass { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 2px; color: rgba(255,255,255,.58); }
        .tco-notch { position: absolute; top: 50%; width: 24px; height: 24px; border-radius: 50%; background: #060608; transform: translateY(-50%); z-index: 5; }
        .tco-notch-l { left: -12px; }
        .tco-notch-r { right: -12px; }
      `}</style>
    </div>
  );
}
