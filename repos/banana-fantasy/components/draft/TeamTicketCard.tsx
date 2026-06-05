'use client';

import React from 'react';
import type { DraftType } from '@/lib/draftRoomConstants';

interface TeamTicketCardProps {
  /** Draft type → drives the foil border colour (pro=purple, hof=gold, jackpot=red). */
  draftType?: DraftType | null;
  /** The 15 picks as display strings (e.g. "BAL QB", "MIN RB1"), in order. */
  players: string[];
  /** Token id = team number (the original draft-pass number). Shown on the card. */
  teamNumber?: string | null;
  /** e.g. "League #1375" — shown under the header when provided. */
  leagueLabel?: string | null;
  /** Tailwind width/sizing on the outer wrapper (defaults to a responsive width). */
  className?: string;
}

const TYPE_FOIL: Record<DraftType, string> = {
  pro: 'linear-gradient(135deg,#5b1d9e 0%,#e9d5ff 22%,#a855f7 46%,#f3e8ff 62%,#7e22ce 82%,#c084fc 100%)',
  hof: 'linear-gradient(135deg,#9c7619 0%,#ffe9a0 22%,#d4af37 42%,#fff6cf 58%,#c0941d 78%,#e8c869 100%)',
  jackpot: 'linear-gradient(135deg,#7f1d1d 0%,#fecaca 22%,#ef4444 46%,#fee2e2 60%,#b91c1c 82%,#f87171 100%)',
};
const STAMP_LABEL: Record<DraftType, string> = { pro: 'PRO', hof: 'HOF', jackpot: 'JACKPOT' };
const STAMP_COLOR: Record<DraftType, string> = { pro: '#a855f7', hof: '#C99700', jackpot: '#ef4444' };

/**
 * The Banana Best Ball IV team card, rendered on-site from team data (not the
 * backend PNG). Mirrors the real ticket art — type-coloured foil border, the
 * BBB IV header + rarity stamp, the roster filled in, the new banana-football
 * logo + SPOILED BANANA SOCIETY footer — and adds the Team #. Used on the
 * generating screen, the roster page, and the marketplace detail.
 */
export function TeamTicketCard({
  draftType,
  players,
  teamNumber,
  leagueLabel,
  className = 'w-[280px] md:w-[320px]',
}: TeamTicketCardProps) {
  const type: DraftType = draftType ?? 'pro';
  const rows = players.slice(0, 15);

  return (
    <div className={`ttc-forge ${className}`}>
      <div className="ttc-card" style={{ background: TYPE_FOIL[type] }}>
        <div className="ttc-ticket">
          <div className="ttc-tinner" />
          <div className="ttc-thead">
            BANANA BEST BALL IV
            <span
              className={`ttc-stamp${type === 'jackpot' ? ' jp' : ''}`}
              style={{ color: STAMP_COLOR[type] }}
            >
              {STAMP_LABEL[type]}
            </span>
          </div>
          {(leagueLabel || teamNumber) && (
            <div className="ttc-sub">
              {leagueLabel}
              {leagueLabel && teamNumber && <span className="ttc-dot">·</span>}
              {teamNumber && <>TEAM #{teamNumber}</>}
            </div>
          )}
          <div className="ttc-rows">
            {rows.map((p, i) => (
              <div key={`${p}-${i}`} className="ttc-row"><span className="ttc-name">{p}</span></div>
            ))}
          </div>
          <div className="ttc-tfoot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sbs-logo-black.png" alt="SBS" />
            <span>SPOILED BANANA SOCIETY</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .ttc-forge{position:relative;max-width:90vw}
        .ttc-card{position:relative;border-radius:18px;aspect-ratio:5/7;overflow:hidden;padding:7px}
        .ttc-ticket{height:100%;border-radius:11px;background:linear-gradient(165deg,#f0dc57,#e2c93f);position:relative;border:1.5px solid #23205c;padding:9px;display:flex;flex-direction:column}
        .ttc-tinner{position:absolute;inset:6px;border:1.2px solid rgba(35,32,92,.5);border-radius:8px;pointer-events:none}
        .ttc-thead{position:relative;text-align:center;color:#23205c;font-weight:900;font-size:12px;letter-spacing:.3px;padding:2px 8px 4px;font-style:italic}
        .ttc-stamp{position:absolute;top:1px;right:6px;font-size:11px;font-weight:900;letter-spacing:.4px;line-height:1;white-space:nowrap;-webkit-text-stroke:.35px currentColor;text-shadow:0 1px 1px rgba(0,0,0,.2)}
        .ttc-stamp.jp{font-size:8.5px;top:3px;right:4px;letter-spacing:0;-webkit-text-stroke:.5px currentColor}
        .ttc-sub{text-align:center;color:rgba(35,32,92,.85);font-weight:800;font-style:italic;font-size:8.5px;letter-spacing:.4px;padding-bottom:4px}
        .ttc-dot{margin:0 5px;opacity:.5}
        .ttc-rows{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:6px 2px 5px;border-top:1.2px solid rgba(35,32,92,.5)}
        .ttc-row{display:flex;align-items:center;min-height:13px}
        .ttc-name{flex:1;text-align:center;color:#23205c;font-weight:800;font-style:italic;font-size:11px;letter-spacing:.2px;white-space:nowrap}
        .ttc-tfoot{display:flex;align-items:center;justify-content:center;gap:6px;padding-top:5px;border-top:1.2px solid rgba(35,32,92,.5)}
        .ttc-tfoot img{width:16px;height:16px;object-fit:contain}
        .ttc-tfoot span{color:#23205c;font-weight:900;font-size:9px;letter-spacing:.3px;font-style:italic}
      `}</style>
    </div>
  );
}
