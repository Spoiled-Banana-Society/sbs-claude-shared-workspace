'use client';

import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Contest } from '@/types';

interface ContestDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contest: Contest | null;
  onEnter: () => void;
}

export function ContestDetailsModal({
  isOpen,
  onClose,
  contest,
  onEnter,
}: ContestDetailsModalProps) {
  if (!contest) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Contest Details" size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-bold text-text-primary">{contest.name}</h3>
              {contest.type === 'jackpot' && <Badge type="jackpot">Jackpot</Badge>}
              {contest.type === 'hof' && <Badge type="hof">HOF</Badge>}
            </div>
            <p className="text-text-secondary">
              {contest.currentEntries.toLocaleString()} entries
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-text-muted">Entry Fee</p>
            <p className="text-2xl font-bold text-banana">{formatCurrency(contest.entryFee)}</p>
          </div>
        </div>

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
          <p className="text-text-secondary text-xs mt-3 pt-3 border-t border-bg-elevated">
            <span className="text-banana font-medium">{formatCurrency(contest.prizePool)} guaranteed minimum.</span>{' '}
            The prize pool grows as more players enter.
            {contest.exampleEntrants && (
              <> This breakdown is an example based on{' '}
                <span className="text-text-primary">{contest.exampleEntrants.toLocaleString()} entrants ({Math.round(contest.exampleEntrants / 10)} leagues)</span>{' '}
                — final payouts scale with the total pool.</>
            )}
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

        {/* Prize Breakdown */}
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
                          {prize.note && (
                            <span className="text-text-muted text-xs font-normal ml-1">{prize.note}</span>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Roster Format */}
        <div>
          <h4 className="font-semibold text-text-primary mb-3">Roster Format</h4>
          <div className="flex flex-wrap gap-2">
            {contest.rosterFormat.map((slot, index) => (
              <div
                key={index}
                className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm"
              >
                <span className="text-banana font-medium">{slot.count}x</span>
                <span className="text-text-secondary ml-1">{slot.position}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scoring Rules */}
        <div>
          <h4 className="font-semibold text-text-primary mb-3">Scoring Rules</h4>
          <div className="grid grid-cols-2 gap-2">
            {contest.scoringRules.slice(0, 6).map((rule, index) => (
              <div
                key={index}
                className="flex justify-between py-2 px-3 bg-bg-tertiary rounded-lg text-sm"
              >
                <span className="text-text-secondary">{rule.action}</span>
                <span className={`font-medium ${rule.points >= 0 ? 'text-success' : 'text-error'}`}>
                  {rule.points >= 0 ? '+' : ''}{rule.points}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-bg-tertiary">
          <Button onClick={onEnter} className="flex-1">
            Enter Draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
