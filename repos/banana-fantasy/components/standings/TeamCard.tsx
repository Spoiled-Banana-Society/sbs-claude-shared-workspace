'use client';

import React from 'react';
import { formatScore, formatRank } from '@/lib/formatters';
import type { League } from '@/types';
import type { ModalTab } from './LeagueDetailModal';

interface TeamCardProps {
  league: League;
  onOpenModal: (league: League, tab: ModalTab) => void;
  index?: number;
}

const typeConfig = {
  jackpot: {
    label: 'Jackpot',
    color: 'bg-jackpot',
    text: 'text-jackpot',
    border: 'border-red-500/40',
    bg: 'bg-gradient-to-r from-red-500/15 via-red-500/5 to-transparent',
    accentBar: 'bg-gradient-to-b from-red-400 to-red-600',
  },
  hof: {
    label: 'HOF',
    color: 'bg-hof',
    text: 'text-hof',
    border: 'border-[#D4AF37]/40',
    bg: 'bg-gradient-to-r from-[#D4AF37]/15 via-[#D4AF37]/5 to-transparent',
    accentBar: 'bg-gradient-to-b from-[#D4AF37] to-yellow-700',
  },
  pro: {
    label: 'Pro',
    color: 'bg-pro',
    text: 'text-pro',
    border: 'border-purple-500/25',
    bg: 'bg-white/[0.02]',
    accentBar: 'bg-gradient-to-b from-purple-400 to-purple-700',
  },
  regular: {
    label: 'Pro',
    color: 'bg-pro',
    text: 'text-pro',
    border: 'border-purple-500/25',
    bg: 'bg-white/[0.02]',
    accentBar: 'bg-gradient-to-b from-purple-400 to-purple-700',
  },
};

function getPlaceBadge(place: number) {
  if (place === 1) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/30 flex-shrink-0">
        <span className="text-xs font-bold text-black">1</span>
      </div>
    );
  }
  if (place === 2) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-300 to-gray-500 flex items-center justify-center shadow-lg shadow-gray-400/30 flex-shrink-0">
        <span className="text-xs font-bold text-black">2</span>
      </div>
    );
  }
  if (place === 3) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-700 flex items-center justify-center shadow-lg shadow-orange-500/30 flex-shrink-0">
        <span className="text-xs font-bold text-white">3</span>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-medium text-white/60">{place}</span>
    </div>
  );
}

export function TeamCard({ league, onOpenModal, index = 0 }: TeamCardProps) {
  const config = typeConfig[league.type] || typeConfig.regular;
  const inTheMoney = league.leagueRank > 0 && league.leagueRank <= 2;
  const isCompleted = league.status === 'completed';

  const actionButtons: { tab: ModalTab; label: string; icon: React.ReactNode }[] = [
    {
      tab: 'roster',
      label: 'Roster',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      tab: 'board',
      label: 'Board',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      tab: 'team',
      label: 'Team',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={`
        animate-card-enter w-full text-left rounded-2xl overflow-hidden border transition-all duration-200
        ${isCompleted ? 'opacity-80' : ''}
        ${config.border} ${config.bg} hover:brightness-125
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-stretch">
        {/* Left accent bar */}
        <div
          className={`w-1.5 flex-shrink-0 rounded-l-2xl ${
            inTheMoney
              ? 'bg-gradient-to-b from-green-400 to-green-600'
              : config.accentBar
          }`}
        />

        <div className="flex-1 px-4 py-4 sm:px-5 min-w-0">
          {/* Top row: rank badge + league name + type pill + prize */}
          <div className="flex items-center gap-2.5 mb-3">
            {league.leagueRank > 0 && getPlaceBadge(league.leagueRank)}
            <h3 className="text-white font-medium text-sm sm:text-base truncate">
              {league.name}
            </h3>
            <span
              className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full flex-shrink-0 ${config.color}/20 ${config.text} ring-1 ring-current/20`}
            >
              {config.label}
            </span>
            {league.prizeIndicator != null && league.prizeIndicator > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 flex-shrink-0">
                ${league.prizeIndicator}
              </span>
            )}
            {inTheMoney && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 flex-shrink-0 border border-green-500/20">
                Advancing
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Rank</p>
              <p className="text-white font-bold text-lg">
                {league.leagueRank > 0 ? (
                  <>{formatRank(league.leagueRank)}<span className="text-white/30 font-normal text-xs ml-0.5">of 10</span></>
                ) : '-'}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Weekly</p>
              <p className="text-white/80 font-semibold text-lg">
                {formatScore(league.weeklyScore)}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Season</p>
              <p className="text-banana font-bold text-lg">
                {formatScore(league.seasonScore)}
              </p>
            </div>
          </div>

          {/* Rank progress bar */}
          {league.leagueRank > 0 && (
            <div className="flex items-center gap-0.5 mb-3">
              {Array.from({ length: 10 }, (_, i) => {
                const pos = i + 1;
                const isYou = pos === league.leagueRank;
                const isAdvancingZone = pos <= 2;
                return (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      isYou
                        ? isAdvancingZone
                          ? 'bg-green-400'
                          : 'bg-banana'
                        : isAdvancingZone
                          ? 'bg-green-500/25'
                          : 'bg-white/[0.06]'
                    }`}
                  />
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {actionButtons.map(({ tab, label, icon }) => (
              <button
                key={tab}
                onClick={() => onOpenModal(league, tab)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.06] text-white/50 hover:text-white/80 text-xs font-medium transition-colors"
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
