'use client';

import React from 'react';
import { Badge } from '../ui/Badge';
import { League } from '@/types';

interface LeagueListProps {
  leagues: League[];
  selectedLeagueId: string | null;
  onSelectLeague: (league: League) => void;
}

export function LeagueList({ leagues, selectedLeagueId, onSelectLeague }: LeagueListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="bg-bg-secondary border border-bg-tertiary rounded-xl overflow-hidden">
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-bg-tertiary border-b border-bg-elevated">
        <div className="col-span-4 text-sm font-medium text-text-muted uppercase tracking-wider">
          League Name
        </div>
        <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
          League Rank
        </div>
        <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
          Weekly Rank
        </div>
        <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
          Weekly Score
        </div>
        <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
          Season Score
        </div>
      </div>

      {/* Table Rows */}
      <div className="divide-y divide-bg-tertiary">
        {leagues.map((league) => (
          <div
            key={league.id}
            onClick={() => onSelectLeague(league)}
            className={`
              grid grid-cols-12 gap-4 px-6 py-4 items-center cursor-pointer transition-colors
              ${selectedLeagueId === league.id ? 'bg-banana/10 border-l-4 border-banana' : 'hover:bg-bg-tertiary/50'}
            `}
          >
            {/* League Name with Prize/Type */}
            <div className="col-span-4 flex items-center gap-2">
              {league.prizeIndicator && (
                <span className="text-banana" title={`Prize: ${formatCurrency(league.prizeIndicator)}`}>
                  🏆
                </span>
              )}
              {league.type === 'jackpot' && <Badge type="jackpot">JP</Badge>}
              {league.type === 'hof' && <Badge type="hof">HOF</Badge>}
              {league.type === 'jackhof' && <Badge type="jackhof">JACKHOF</Badge>}
              <span className="text-text-primary font-medium">{league.name}</span>
            </div>

            {/* League Rank */}
            <div className="col-span-2 text-center">
              <span className="font-bold text-text-primary">{league.leagueRank}</span>
            </div>

            {/* Weekly Rank */}
            <div className="col-span-2 text-center">
              <span className="text-text-secondary">{league.weeklyRank.toLocaleString()}</span>
            </div>

            {/* Weekly Score */}
            <div className="col-span-2 text-center">
              <span className="text-text-secondary">{league.weeklyScore}</span>
            </div>

            {/* Season Score */}
            <div className="col-span-2 text-center">
              <span className="font-medium text-banana">{league.seasonScore}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {leagues.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-text-muted">You haven&apos;t joined any leagues yet.</p>
          <p className="text-text-secondary mt-2">
            Start drafting to see your teams here!
          </p>
        </div>
      )}
    </div>
  );
}
