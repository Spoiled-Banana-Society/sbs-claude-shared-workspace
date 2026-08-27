'use client';

import React, { useState } from 'react';
import { useSlowClock } from '@/contexts/SlowClockContext';
import { Tooltip } from '../ui/Tooltip';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { CompletedDraft } from '@/types';

interface CompletedDraftsProps {
  drafts: CompletedDraft[];
  onViewDetails?: (draft: CompletedDraft) => void;
}

export function CompletedDrafts({ drafts, onViewDetails }: CompletedDraftsProps) {
  const { copy: slowClock } = useSlowClock();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getPlaceBadge = (place: number) => {
    if (place === 1) {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/30">
          <span className="text-sm font-bold text-black">1</span>
        </div>
      );
    }
    if (place === 2) {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-500 flex items-center justify-center shadow-lg shadow-gray-400/30">
          <span className="text-sm font-bold text-black">2</span>
        </div>
      );
    }
    if (place === 3) {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-700 flex items-center justify-center shadow-lg shadow-orange-500/30">
          <span className="text-sm font-bold text-white">3</span>
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
        <span className="text-sm font-medium text-white/70">{place}</span>
      </div>
    );
  };

  const totalWinnings = drafts.reduce((sum, d) => sum + d.prizeWon, 0);
  const totalWins = drafts.filter(d => d.finalPlace === 1).length;

  return (
    <div>
      {/* Summary Stats */}
      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-sm">Completed:</span>
          <span className="text-white font-medium">{drafts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-sm">Wins:</span>
          <span className="text-green-400 font-medium">{totalWins}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-sm">Total Won:</span>
          <span className="text-banana font-bold">{formatCurrency(totalWinnings)}</span>
        </div>
      </div>

      {/* Completed Drafts Cards */}
      <div className="space-y-3">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className={`
              rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer
              ${(draft.type === 'jackpot' || draft.type === 'jackhof')
                ? 'border-red-500/30 bg-gradient-to-r from-red-500/[0.08] to-transparent hover:from-red-500/[0.12]'
                : draft.type === 'hof'
                ? 'border-[#FFD700]/30 bg-gradient-to-r from-[#FFD700]/[0.08] to-transparent hover:from-[#FFD700]/[0.12]'
                : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
              }
            `}
            onClick={() => setExpandedId(expandedId === draft.id ? null : draft.id)}
          >
            {/* Main Row */}
            <div className="px-5 py-4 flex items-center gap-6">
              {/* Place Badge */}
              <div className="flex-shrink-0">
                {getPlaceBadge(draft.finalPlace)}
              </div>

              {/* Contest Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-medium">{draft.contestName}</span>
                  <Tooltip content={draft.draftSpeed === 'fast' ? '30 seconds per pick' : slowClock.perPick}>
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {draft.draftSpeed === 'fast' ? '30s' : slowClock.short}
                    </span>
                  </Tooltip>
                  {draft.type === 'jackpot' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                      Jackpot
                    </span>
                  )}
                  {draft.type === 'hof' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFD700]/20 text-[#FFD700] font-medium">
                      HOF
                    </span>
                  )}
                  {draft.type === 'jackhof' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gradient-to-r from-red-500/20 to-[#FFD700]/20 font-medium">
                      <span className="text-red-400">Jack</span><span className="text-[#FFD700]">HOF</span>
                    </span>
                  )}
                  <VerifiedBadge type="draft-type" draftType={draft.type} size="sm" draftId={draft.id} />
                </div>
                <div className="flex items-center gap-3 text-sm text-white/50">
                  <span>{formatDate(draft.completedDate)}</span>
                  <span>•</span>
                  <span>{draft.finalPlace > 0 ? `${draft.finalPlace}/${draft.totalPlayers}` : '-'}</span>
                </div>
              </div>

              {/* Score */}
              <div className="text-right flex-shrink-0">
                <div className="text-white font-bold text-lg">{draft.score.toFixed(1)}</div>
                <div className="text-white/40 text-xs">pts</div>
              </div>

              {/* Prize */}
              <div className="text-right flex-shrink-0 min-w-[80px]">
                {draft.prizeWon > 0 ? (
                  <div className={`font-bold text-lg ${
                    draft.type === 'jackpot' ? 'text-red-400' :
                    draft.type === 'hof' ? 'text-[#FFD700]' :
                    'text-green-400'
                  }`}>
                    {formatCurrency(draft.prizeWon)}
                  </div>
                ) : (
                  <div className="text-white/30 text-sm">No prize</div>
                )}
              </div>

              {/* Expand Icon */}
              <div className="flex-shrink-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`text-white/40 transition-transform duration-200 ${
                    expandedId === draft.id ? 'rotate-180' : ''
                  }`}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>

            {/* Expanded Content */}
            {expandedId === draft.id && (
              <div className="px-5 pb-4 pt-0 border-t border-white/[0.06]">
                <div className="pt-4">
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Top Performers</div>
                  <div className="flex gap-4">
                    {draft.topPlayers.map((player, idx) => (
                      <div
                        key={idx}
                        className="flex-1 bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]"
                      >
                        <div className="text-white/50 text-xs mb-1">{player.team} {player.position}</div>
                        <div className="text-white font-bold">{player.points.toFixed(1)} pts</div>
                      </div>
                    ))}
                  </div>
                  {onViewDetails && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDetails(draft);
                      }}
                      className="mt-4 w-full py-2.5 text-sm font-medium rounded-xl bg-white/[0.05] text-white/70 hover:bg-white/[0.08] hover:text-white transition-all border border-white/[0.06]"
                    >
                      View Full Draft Board
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Empty State */}
      {drafts.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center">
          <p className="text-white/40">No completed drafts yet</p>
          <p className="text-white/30 text-sm mt-1">
            Your finished drafts will appear here
          </p>
        </div>
      )}
    </div>
  );
}
