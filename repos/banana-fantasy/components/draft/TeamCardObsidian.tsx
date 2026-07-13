'use client';

import React from 'react';

/**
 * Obsidian NFT card — single source of truth for the in-app render of both:
 *  - the post-draft TEAM card (tier foil frame + roster GROUPED by position)
 *  - the pre-reveal grey DRAFT PASS  (`preReveal`)
 *
 * Locked designs: ~/Desktop/obsidian-team-grouped-trio.html (team) and
 * ~/Desktop/obsidian-draftpass-v4.html (grey pass). The 1080x1350 (4:5) NFT
 * PNG is produced separately by /api/og/team-card using the same design.
 *
 * Rendered at a fixed design size and CSS-scaled to `width` so it is
 * pixel-faithful at any display size (generating screen, roster page, etc.).
 */

export type CardTier = 'pro' | 'hof' | 'jackpot';

export interface CardPlayer {
  team: string;            // "BAL"
  pos: string;             // "QB" | "RB1" | "WR1" | "TE" | "DST"
  bye?: number | string;   // derived from ALL_POSITIONS in the og route if absent
  adp?: number | string;
  pick?: number | string;
}

interface Props {
  tier?: CardTier;
  players?: CardPlayer[];
  passNumber?: string | number | null;
  /** Team card identity line: on-chain token id (Team #) + league number. */
  teamNumber?: string | number | null;
  leagueNumber?: string | number | null;
  preReveal?: boolean;
  /** Generating-screen animation: rows with global index < revealCount are visible. */
  revealCount?: number;
  /** Display width in px. */
  width?: number;
  className?: string;
}

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

// On-dark position colors — brightened variants of the canonical POSITION_COLORS
// in lib/draftRoomConstants.ts (QB red / RB green / WR purple / TE blue / DST orange).
const POS_ON_DARK: Record<string, string> = {
  QB: '#ff5a5f', RB: '#69c93f', WR: '#d98cf0', TE: '#5b8cff', DST: '#f0a050',
};
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
const basePos = (p: string) => p.replace(/[0-9]/g, '').toUpperCase();
export const posColorOnDark = (pos: string) => POS_ON_DARK[basePos(pos)] || '#9aa0ab';

// Design sizes (card only; frame adds 4px each side).
const TEAM_W = 340, TEAM_H = 540;
const PASS_W = 320, PASS_H = 452;

export default function TeamCardObsidian({
  tier = 'pro',
  players = [],
  passNumber,
  teamNumber,
  leagueNumber,
  preReveal = false,
  revealCount,
  width = 320,
  className,
}: Props) {
  const dw = (preReveal ? PASS_W : TEAM_W) + 8;
  const dh = (preReveal ? PASS_H : TEAM_H) + 8;
  const scale = width / dw;
  const shownThrough = revealCount == null ? players.length : revealCount;
  const passNo = passNumber != null && passNumber !== '' ? `#${passNumber}` : '';
  const idsLine = [
    teamNumber != null && teamNumber !== '' ? `TEAM #${teamNumber}` : '',
    leagueNumber != null && leagueNumber !== '' ? `LEAGUE #${leagueNumber}` : '',
  ].filter(Boolean).join(' · ');

  // Group players by position (QB/RB/WR/TE/DST), preserving order within group,
  // and assign each a global index for the reveal animation.
  const groups = POS_ORDER
    .map((pos) => ({ pos, players: players.filter((p) => basePos(p.pos) === pos) }))
    .filter((g) => g.players.length > 0);
  let gi = 0;

  return (
    <div className={className} style={{ width, height: dh * scale, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: 'top left', width: dw, height: dh }}>
        <div className="tco-frame" style={{ background: preReveal ? GREY_FRAME : FRAME[tier] }}>
          <div className={`tco-card${preReveal ? ' tco-pass' : ''}`}>
            {preReveal ? (
              <>
                <div className="tco-perf" />
                <div className="tco-pad tco-pad-pass">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="tco-logo tco-logo-pass" src="/sbs-logo-white.png" alt="SBS" />
                  <div className="tco-dp">{`DRAFT PASS ${passNo}`.trim()}</div>
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
                {idsLine ? <div className="tco-ids">{idsLine}</div> : null}
                <div className="tco-badge" style={{ color: BADGE[tier].text, background: BADGE[tier].bg, boxShadow: `0 0 0 1px ${BADGE[tier].line} inset` }}>
                  {BADGE[tier].label}
                </div>
                <div className="tco-colh">
                  <span className="tco-sp" />
                  <span className="tco-c">BYE</span>
                  <span className="tco-c">ADP</span>
                  <span className="tco-c">PICK</span>
                </div>
                <div className="tco-roster">
                  {groups.map((g) => {
                    const c = posColorOnDark(g.pos);
                    return (
                      <div className="tco-sec" key={g.pos}>
                        <div className="tco-sechd" style={{ color: c }}>{g.pos}</div>
                        {g.players.map((p) => {
                          const shown = gi++ < shownThrough;
                          return (
                            <div className="tco-prow" key={`${p.team}-${p.pos}-${gi}`} style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(3px)' }}>
                              <span className="tco-bar" style={{ background: c }} />
                              <span className="tco-nm">{p.team}-{p.pos}</span>
                              <span className="tco-sp" />
                              <span className="tco-st">{p.bye}</span>
                              <span className="tco-st">{p.adp}</span>
                              <span className="tco-st">{p.pick}</span>
                            </div>
                          );
                        })}
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
          width: ${TEAM_W}px; height: ${TEAM_H}px; border-radius: 23px; position: relative; overflow: hidden;
          background: linear-gradient(172deg,#17171e 0%,#0d0d12 58%,#070709 100%);
        }
        .tco-card.tco-pass { width: ${PASS_W}px; height: ${PASS_H}px; }
        /* text-align:left makes the card self-contained — parents like the
           generating screen (.dc-wrap) and roster page (.text-center) impose
           text-align:center, which would otherwise be INHERITED by the section
           headers (.tco-sechd) and push QB/RB/WR/TE/DST to the middle. The
           logo/title/badge stay centered via flex align-items, not text-align. */
        .tco-pad { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; padding: 14px 16px 14px; align-items: center; text-align: left; }
        .tco-logo { width: 26px; height: 26px; object-fit: contain; opacity: .92; filter: drop-shadow(0 1px 3px rgba(0,0,0,.55)); }
        .tco-title { margin-top: 5px; font-size: 12px; font-weight: 700; letter-spacing: .6px; color: rgba(255,255,255,.85); }
        .tco-ids { margin-top: 4px; font-size: 8.5px; font-weight: 700; letter-spacing: 1.4px; color: rgba(255,255,255,.42); }
        .tco-badge { margin-top: 7px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 11px; border-radius: 30px; font-size: 11px; font-weight: 900; letter-spacing: 1.5px; }

        .tco-colh { width: 100%; display: flex; align-items: flex-end; margin-top: 12px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,.12); }
        .tco-c { width: 34px; text-align: right; font-size: 8px; font-weight: 800; letter-spacing: 1px; color: rgba(255,255,255,.3); }
        .tco-sp { flex: 1; }

        .tco-roster { width: 100%; flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding-top: 4px; }
        .tco-sechd { font-size: 11px; font-weight: 900; letter-spacing: 1px; margin: 3px 0 1px; }
        .tco-prow { display: flex; align-items: center; height: 17px; transition: opacity .45s ease, transform .45s ease; }
        .tco-bar { width: 2.5px; height: 12px; border-radius: 2px; margin-right: 8px; flex: 0 0 auto; }
        .tco-nm { font-size: 11.5px; font-weight: 800; letter-spacing: .2px; color: #fff; white-space: nowrap; }
        .tco-st { width: 34px; text-align: right; font-size: 9.5px; font-weight: 700; color: rgba(255,255,255,.82); font-variant-numeric: tabular-nums; }
        .tco-foot { margin-top: 10px; font-size: 10px; font-weight: 800; letter-spacing: .6px; color: rgba(255,255,255,.55); }

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
