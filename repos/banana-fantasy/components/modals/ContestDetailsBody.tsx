'use client';

import React from 'react';
import type { Contest } from '@/types';

/**
 * Shared contest body — the prize pool, draft-type odds, scoring, roster, and
 * prize breakdown. Rendered BOTH in the standalone ContestDetailsModal (from
 * contest cards) and in the DraftInfoModal "Contest" tab (the ⓘ button), so
 * the two always show the exact same thing. The card-style visual is the one
 * we standardized on (colored Pro/HOF/Jackpot tiles, prize-pool tiles).
 */

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

// Official SBS Best Ball scoring — sourced from the live scorer
// (sbs-cloud-functions / sportsDataScore.js). Full PPR, with yardage bonuses
// and the complete DST table. Same for every contest, so it lives here as a
// fixed reference rather than per-contest data.
interface ScoreRow { label: string; value: string; bonus?: boolean }
interface ScoreGroup { title: string; rows: ScoreRow[] }

const SCORING: ScoreGroup[] = [
  {
    title: 'Passing',
    rows: [
      { label: 'Passing TD', value: '+4' },
      { label: 'Passing yards', value: '+1 per 25' },
      { label: '300+ passing yards', value: '+3', bonus: true },
      { label: 'Interception thrown', value: '−1' },
    ],
  },
  {
    title: 'Rushing',
    rows: [
      { label: 'Rushing TD', value: '+6' },
      { label: 'Rushing yards', value: '+1 per 10' },
      { label: '100+ rushing yards', value: '+3', bonus: true },
    ],
  },
  {
    title: 'Receiving',
    rows: [
      { label: 'Receiving TD', value: '+6' },
      { label: 'Receiving yards', value: '+1 per 10' },
      { label: '100+ receiving yards', value: '+3', bonus: true },
      { label: 'Reception', value: '+1' },
    ],
  },
  {
    title: 'Misc',
    rows: [
      { label: 'Fumble lost', value: '−1' },
      { label: 'Fumble-return TD', value: '+6' },
      { label: '2-point conversion', value: '+2' },
    ],
  },
  {
    title: 'Defense / Special Teams',
    rows: [
      { label: 'Sack', value: '+1' },
      { label: 'Interception', value: '+2' },
      { label: 'Fumble recovery', value: '+1' },
      { label: 'Forced fumble', value: '+1' },
      { label: 'Safety', value: '+2' },
      { label: 'Defensive / ST TD', value: '+6' },
      { label: 'Blocked kick', value: '+2' },
    ],
  },
  {
    title: 'Points Allowed (DST)',
    rows: [
      { label: '0 points', value: '+10' },
      { label: '1–6', value: '+7' },
      { label: '7–13', value: '+4' },
      { label: '14–20', value: '+1' },
      { label: '21–27', value: '0' },
      { label: '28–34', value: '−1' },
      { label: '35+', value: '−4' },
    ],
  },
];

// No kicker is scored (QB/RB/WR/TE/DST), so drop any stray "K" the contest
// data still lists. Also strip the "· N leagues" example count from per-league
// prize notes — the count is illustrative and reads as confusing precision.
const isKicker = (position: string) => /^k$/i.test(position.trim());
const cleanNote = (note?: string) =>
  (note ?? '').replace(/\s*·\s*[\d,]+\s*leagues?/i, '').trim();

export function ContestDetailsBody({ contest }: { contest: Contest }) {
  const roster = (contest.rosterFormat ?? []).filter((s) => !isKicker(s.position));

  return (
    <div className="space-y-6">
      {/* Prize Pool */}
      <div className="bg-bg-tertiary rounded-xl p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-text-muted">Prize Pool</p>
            <p className="text-2xl font-bold text-text-primary">
              {formatCurrency(contest.prizePool)} <span className="text-sm text-text-muted">GTD</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Top Prize</p>
            <p className="text-2xl font-bold text-success">{formatCurrency(contest.topPrize)}</p>
          </div>
        </div>
        <p className="text-text-secondary text-xs mt-3 pt-3 border-t border-bg-elevated leading-relaxed">
          <span className="text-banana font-medium">{formatCurrency(contest.prizePool)} guaranteed minimum.</span>{' '}
          The pool shown is an example — it grows as more teams enter, so it only goes up from here. Enter as many drafts as you want — more teams, more paths to the playoffs. Top finishers advance through the playoffs for the grand prize.
        </p>
      </div>

      {/* Draft Type Odds */}
      <div className="flex gap-4">
        <div className="flex-1 bg-pro/10 rounded-xl p-4 border border-pro/20">
          <p className="text-sm text-pro">Pro</p>
          <p className="text-3xl font-bold text-pro">94%</p>
        </div>
        <div className="flex-1 bg-hof/10 rounded-xl p-4 border border-hof/20">
          <p className="text-sm text-hof">Hall of Fame</p>
          <p className="text-3xl font-bold text-hof">5%</p>
        </div>
        <div className="flex-1 bg-jackpot/10 rounded-xl p-4 border border-jackpot/20">
          <p className="text-sm text-jackpot">Jackpot</p>
          <p className="text-3xl font-bold text-jackpot">1%</p>
        </div>
      </div>

      {/* Guaranteed Distribution */}
      <div className="bg-bg-tertiary/50 rounded-xl p-3 border border-bg-tertiary">
        <p className="text-text-secondary text-xs text-center">
          <span className="text-text-primary font-medium">Guaranteed distribution:</span> Every 100 paid drafts contains exactly 1 Jackpot, 5 HOF, and 94 Pro. The order is randomized, but the distribution is guaranteed. Players can also win Jackpot and HOF entries on the Banana Wheel.
        </p>
      </div>

      {/* Scoring — full official rules, grouped, with bonuses + defense */}
      <div>
        <h4 className="font-semibold text-text-primary mb-1">Scoring</h4>
        <p className="text-text-muted text-xs mb-3">Full PPR · highest scorer at each team-position counts every week.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SCORING.map((group) => (
            <div key={group.title} className="bg-bg-tertiary rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-bg-elevated/40 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {group.title}
              </div>
              {group.rows.map((row, i) => {
                const negative = row.value.startsWith('−');
                return (
                  <div
                    key={row.label}
                    className={`flex items-center justify-between px-4 py-2 text-sm ${i > 0 ? 'border-t border-bg-elevated' : ''}`}
                  >
                    <span className={row.bonus ? 'text-banana' : 'text-text-secondary'}>
                      {row.label}
                      {row.bonus && <span className="text-banana/60 text-[10px] font-semibold uppercase ml-1.5">bonus</span>}
                    </span>
                    <span className={`font-medium tabular-nums ${negative ? 'text-error' : 'text-success'}`}>{row.value}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Roster Format */}
      {roster.length > 0 && (
        <div>
          <h4 className="font-semibold text-text-primary mb-3">Roster Format</h4>
          <div className="flex flex-wrap gap-2">
            {roster.map((slot, index) => (
              <div key={index} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm">
                <span className="text-banana font-medium">{slot.count}x</span>
                <span className="text-text-secondary ml-1">{slot.position}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prize Breakdown */}
      {contest.prizeBreakdown && contest.prizeBreakdown.length > 0 && (
        <div>
          <h4 className="font-semibold text-text-primary mb-3">Prize Breakdown</h4>
          <div className="bg-bg-tertiary rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-bg-elevated">
                  <th className="text-left py-3 px-4 text-sm text-text-muted font-medium">Place</th>
                  <th className="text-right py-3 px-4 text-sm text-text-muted font-medium">Prize</th>
                </tr>
              </thead>
              <tbody>
                {contest.prizeBreakdown.map((prize, index) => {
                  const prevSection = index > 0 ? contest.prizeBreakdown[index - 1].section : undefined;
                  const showSection = prize.section && prize.section !== prevSection;
                  const note = cleanNote(prize.note);
                  return (
                    <React.Fragment key={index}>
                      {showSection && (
                        <tr className="bg-bg-elevated/40">
                          <td colSpan={2} className="py-2 px-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
                            {prize.section}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-bg-elevated last:border-0">
                        <td className="py-3 px-4 text-text-primary">{prize.place}</td>
                        <td className="py-3 px-4 text-right text-text-primary font-medium">
                          {formatCurrency(prize.amount)}
                          {note && <span className="text-text-muted text-xs font-normal ml-1">{note}</span>}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
