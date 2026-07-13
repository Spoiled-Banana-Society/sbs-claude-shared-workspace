'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { formatScore } from '@/lib/formatters';
import { getTruncatedAccountName } from '@/utils/helpers';
import { useLeagueDetail } from '@/hooks/useStandings';
import type { League } from '@/types';

interface LeagueStandingsViewProps {
  league: League;
  gameweek: string;
}

function ExpandedRoster() {
  return (
    <div className="px-4 py-3 border-t border-white/[0.04]">
      <p className="text-white/30 text-xs italic">Roster details coming soon</p>
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`transition-transform duration-200 ease-out ${expanded ? 'rotate-180' : 'rotate-0'}`}
    >
      <path
        d="M3.5 5.25L7 8.75L10.5 5.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandableRow({
  entry,
  isExpandable,
  isExpanded,
  onToggle,
}: {
  entry: {
    rank: number;
    displayName: string;
    weeklyScore: number;
    seasonScore: number;
    isCurrentUser: boolean;
  };
  isExpandable: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [isExpanded]);

  return (
    <div
      className={`
        rounded-lg overflow-hidden transition-colors
        ${entry.isCurrentUser ? 'bg-banana/[0.08] ring-1 ring-banana/20' : ''}
        ${!entry.isCurrentUser && isExpanded ? 'bg-white/[0.04] ring-1 ring-white/[0.06]' : ''}
        ${!entry.isCurrentUser && !isExpanded ? 'hover:bg-white/[0.03]' : ''}
      `}
    >
      <div
        onClick={isExpandable ? onToggle : undefined}
        className={`
          grid grid-cols-[40px_1fr_70px_70px_20px] sm:grid-cols-[50px_1fr_100px_100px_24px] gap-2 px-3 py-2.5 items-center
          ${isExpandable ? 'cursor-pointer' : ''}
        `}
      >
        {/* Rank */}
        <div>
          {entry.rank <= 3 ? (
            <span
              className={`
                w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${entry.rank === 1 ? 'bg-yellow-500 text-black' : ''}
                ${entry.rank === 2 ? 'bg-gray-400 text-black' : ''}
                ${entry.rank === 3 ? 'bg-orange-600 text-white' : ''}
              `}
            >
              {entry.rank}
            </span>
          ) : (
            <span className="text-white/50 text-sm font-medium">{entry.rank}</span>
          )}
        </div>

        {/* Name */}
        <div className={`text-sm font-medium truncate ${entry.isCurrentUser ? 'text-banana' : 'text-white/80'}`}>
          {entry.displayName}
          {entry.isCurrentUser && <span className="ml-1.5 text-[10px] text-banana/60">(You)</span>}
        </div>

        {/* Weekly */}
        <div className="text-right text-white/60 text-sm">
          {formatScore(entry.weeklyScore)}
        </div>

        {/* Season */}
        <div className={`text-right font-semibold text-sm ${entry.isCurrentUser ? 'text-banana' : 'text-white'}`}>
          {formatScore(entry.seasonScore)}
        </div>

        {/* Chevron */}
        <div className="flex items-center justify-center">
          {isExpandable ? (
            <span className="text-white/25">
              <ChevronIcon expanded={isExpanded} />
            </span>
          ) : (
            <span className="w-[14px]" />
          )}
        </div>
      </div>

      {/* Expandable roster area */}
      {isExpandable && (
        <div
          style={{
            height: isExpanded ? height : 0,
            opacity: isExpanded ? 1 : 0,
            transition: 'height 200ms ease-out, opacity 150ms ease-out',
          }}
          className="overflow-hidden"
        >
          <div ref={contentRef}>
            <ExpandedRoster />
          </div>
        </div>
      )}
    </div>
  );
}

export function LeagueStandingsView({ league, gameweek }: LeagueStandingsViewProps) {
  const draftId = league.id;
  const { data: rawStandings, isValidating, error } = useLeagueDetail(draftId, gameweek);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Map raw API data to display format
  const standings = (rawStandings || []).map((entry: unknown, idx: number) => {
    if (typeof entry !== 'object' || !entry) {
      return { rank: idx + 1, displayName: '-', weeklyScore: 0, seasonScore: 0, isCurrentUser: false };
    }
    const e = entry as Record<string, unknown>;
    return {
      rank: typeof e.rank === 'number' ? e.rank : idx + 1,
      // Real name if there is one; otherwise the on-brand "Banana #1234"
      // default — never a raw wallet address.
      displayName: getTruncatedAccountName(String(e.displayName || ''), String(e.ownerWallet || e.cardId || '')) ?? '',
      weeklyScore: Number(e.weeklyScore ?? e.weekScore ?? e.scoreWeek ?? 0),
      seasonScore: Number(e.seasonScore ?? e.scoreSeason ?? 0),
      isCurrentUser: Boolean(e.isCurrentUser),
    };
  });

  const handleToggle = useCallback((idx: number) => {
    setExpandedIndex((prev) => (prev === idx ? null : idx));
  }, []);

  if (isValidating && standings.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || standings.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-white/40 text-sm">League standings not available yet</p>
        <p className="text-white/25 text-xs mt-1">Check back after gameweek scores are calculated</p>
      </div>
    );
  }

  return (
    <div>
      {/* Table header */}
      <div className="grid grid-cols-[40px_1fr_70px_70px_20px] sm:grid-cols-[50px_1fr_100px_100px_24px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">
        <div>#</div>
        <div>Player</div>
        <div className="text-right">Weekly</div>
        <div className="text-right">Season</div>
        <div />
      </div>

      <div className="space-y-1">
        {standings.map((entry, idx: number) => {
          const isTop2 = entry.rank <= 2;
          const isExpandable = !entry.isCurrentUser;

          return (
            <React.Fragment key={idx}>
              <ExpandableRow
                entry={entry}
                isExpandable={isExpandable}
                isExpanded={expandedIndex === idx}
                onToggle={() => handleToggle(idx)}
              />

              {/* Advancement line between rank 2 and 3 */}
              {isTop2 && entry.rank === 2 && standings.length > 2 && (
                <div className="flex items-center gap-2 px-3 py-1">
                  <div className="flex-1 h-px bg-green-500/30" />
                  <span className="text-[9px] uppercase tracking-wider text-green-500/50 font-medium">Advance</span>
                  <div className="flex-1 h-px bg-green-500/30" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
