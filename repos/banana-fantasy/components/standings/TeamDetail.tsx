'use client';

import React, { useState } from 'react';
import { formatScore, formatRank } from '@/lib/formatters';
import { RosterView } from './RosterView';
import { LeagueStandingsView } from './LeagueStandingsView';
import { DraftBoardView } from './DraftBoardView';
import type { League } from '@/types';

interface TeamDetailProps {
  league: League;
  gameweek: string;
}

type DetailTab = 'roster' | 'league' | 'draftboard';

const typeConfig = {
  jackpot: { label: 'Jackpot', text: 'text-jackpot', bg: 'bg-jackpot/10' },
  hof: { label: 'HOF', text: 'text-hof', bg: 'bg-hof/10' },
  pro: { label: 'Pro', text: 'text-pro', bg: 'bg-pro/10' },
  regular: { label: 'Pro', text: 'text-pro', bg: 'bg-pro/10' },
  jackhof: { label: 'JackHOF', text: 'text-hof', bg: 'bg-jackpot/10' },
};

export function TeamDetail({ league, gameweek }: TeamDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('roster');
  const config = typeConfig[league.type] || typeConfig.regular;

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'roster', label: 'Roster' },
    { id: 'league', label: 'League' },
    { id: 'draftboard', label: 'Draft Board' },
  ];

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-5 border-b border-white/[0.06] bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
                {config.label}
              </span>
              <span className="text-white/30 text-xs">{league.draftDate ? new Date(league.draftDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
            </div>
            <h3 className="text-lg font-bold text-white">{league.name}</h3>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-banana">{formatScore(league.seasonScore)}</p>
            <p className="text-white/40 text-xs">Season Score</p>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 text-sm">
          <span className="text-white/50">
            League Rank: <span className="text-white font-semibold">{league.leagueRank > 0 ? formatRank(league.leagueRank) : '-'}</span>
          </span>
          <span className="text-white/20">|</span>
          <span className="text-white/50">
            Weekly: <span className="text-white font-semibold">{formatScore(league.weeklyScore)}</span>
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 py-3 text-sm font-medium transition-colors relative
              ${activeTab === tab.id
                ? 'text-banana'
                : 'text-white/40 hover:text-white/70'
              }
            `}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-banana rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {activeTab === 'roster' && <RosterView league={league} />}
        {activeTab === 'league' && <LeagueStandingsView league={league} gameweek={gameweek} />}
        {activeTab === 'draftboard' && <DraftBoardView league={league} />}
      </div>
    </div>
  );
}
