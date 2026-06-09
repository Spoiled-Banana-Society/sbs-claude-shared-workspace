'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatScore, formatRank } from '@/lib/formatters';
import type { League } from '@/types';
import type { MarketplaceTeam } from '@/lib/opensea';
import type { ModalTab } from './LeagueDetailModal';
import { FounderPill } from '@/components/drafting/FounderPill';
import { useUnreadChatCount } from '@/hooks/useUnreadChatCount';
import { hasSeasonStarted } from '@/lib/draftTypes';

interface TeamCardProps {
  league: League;
  onOpenModal: (league: League, tab: ModalTab) => void;
  index?: number;
  /** Custom nickname the user set for this league. Falls back to
   *  league.name when missing/empty. */
  nickname?: string;
  /** Save handler — empty string clears the nickname. */
  onRename?: (leagueId: string, name: string) => Promise<void> | void;
  /** Authenticated wallet — used to scope the chat unread badge. */
  walletAddress?: string;
  /** This league's marketplace NFT (tokenId + listing), matched by leagueId. */
  marketplaceTeam?: MarketplaceTeam | null;
  /** Kept for prop compatibility — listing is handled in the marketplace, not here. */
  onListed?: (tokenId: string, orderHash: string, price: number) => void;
  onCancelled?: (tokenId: string) => void;
}

const typeConfig = {
  jackpot: {
    label: 'Jackpot',
    color: 'bg-jackpot',
    text: 'text-jackpot',
    border: 'border-red-500/40',
    bg: 'bg-gradient-to-r from-red-500/10 via-red-500/[0.03] to-transparent',
  },
  hof: {
    label: 'HOF',
    color: 'bg-hof',
    text: 'text-hof',
    border: 'border-[#D4AF37]/40',
    bg: 'bg-gradient-to-r from-[#D4AF37]/10 via-[#D4AF37]/[0.03] to-transparent',
  },
  pro: {
    label: 'Pro',
    color: 'bg-pro',
    text: 'text-pro',
    border: 'border-purple-500/25',
    bg: 'bg-white/[0.02]',
  },
  regular: {
    label: 'Pro',
    color: 'bg-pro',
    text: 'text-pro',
    border: 'border-purple-500/25',
    bg: 'bg-white/[0.02]',
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

export function TeamCard({ league, onOpenModal, index = 0, nickname, onRename, walletAddress, marketplaceTeam }: TeamCardProps) {
  const unreadCount = useUnreadChatCount(league.id, walletAddress);

  const mt = marketplaceTeam;
  const isListed = !!mt?.orderHash;

  const [showCard, setShowCard] = useState(false);
  const downloadCard = async () => {
    if (!mt?.imageUrl) return;
    try {
      const res = await fetch(mt.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sbs-team-${mt.tokenId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore download failure */ }
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname || '');
  useEffect(() => { setDraft(nickname || ''); }, [nickname]);
  const canEdit = typeof onRename === 'function';
  // Title = "Team #<tokenId>" (the NFT), with the league number as a subtitle —
  // never the raw league name / "Draft Pass" copy. Falls back to the league name
  // only if we somehow don't have the token id.
  const teamLabel = mt?.tokenId ? `Team #${mt.tokenId}` : league.name;
  const displayName = nickname?.trim() || teamLabel;
  const leagueNo = mt?.leagueNumber ?? (league.name.match(/#\s*(\d+)/)?.[1] ?? null);
  const commit = () => {
    if (!onRename) return;
    void onRename(league.id, draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(nickname || '');
    setEditing(false);
  };
  const config = typeConfig[league.type] || typeConfig.regular;
  // No real scoring until kickoff — pre-season rank/score values are placeholder
  // seed data on the pass, so suppress them. A real rank is a 1-10 league position.
  const seasonStarted = hasSeasonStarted();
  const validRank = league.leagueRank >= 1 && league.leagueRank <= 10;
  const showRank = seasonStarted && validRank;
  const inTheMoney = showRank && league.leagueRank <= 2;
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
      tab: 'chat',
      label: 'Chat',
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
        {/* Obsidian team card image — the hero. Big (4:5) so the whole card
            reads. Tap → full-screen "View card" lightbox. */}
        <button
          type="button"
          onClick={() => mt?.imageUrl && setShowCard(true)}
          className="group/img w-[150px] sm:w-[240px] aspect-[4/5] flex-shrink-0 self-start relative bg-[#070709] border-r border-white/[0.06] overflow-hidden"
          aria-label="View team card"
        >
          {mt?.imageUrl ? (
            <Image
              src={mt.imageUrl}
              alt={`Team #${mt.tokenId}`}
              fill
              className="object-cover group-hover/img:scale-[1.03] transition-transform duration-300"
              sizes="(max-width: 640px) 150px, 240px"
            />
          ) : (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${config.bg}`}>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${config.text}`}>{config.label}</span>
              <span className="text-white/80 font-mono text-sm">{mt?.tokenId ? `Team #${mt.tokenId}` : 'Team'}</span>
            </div>
          )}
          {/* Always-visible "View card" affordance */}
          {mt?.imageUrl && (
            <div className="absolute inset-x-0 bottom-0 pt-8 pb-2.5 flex items-end justify-center bg-gradient-to-t from-black/70 to-transparent">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-white/90 bg-black/45 backdrop-blur-sm px-2.5 py-1 rounded-full group-hover/img:bg-black/70 transition-colors">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M14 10l7-7M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
                View card
              </span>
            </div>
          )}
        </button>

        <div className="flex-1 px-4 py-4 sm:px-5 min-w-0 self-center">
          {/* Top row: rank badge + team name + type pill */}
          <div className="flex items-center gap-2.5 mb-3">
            {showRank && getPlaceBadge(league.leagueRank)}
            {editing ? (
              <input
                autoFocus
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  else if (e.key === 'Escape') cancel();
                }}
                onBlur={commit}
                placeholder={league.name}
                className="bg-bg-elevated text-white text-sm sm:text-base px-2 py-0.5 rounded border border-banana/40 outline-none focus:border-banana min-w-0 flex-1"
              />
            ) : (
              <h3
                className="text-white font-semibold text-base sm:text-lg truncate flex items-center gap-1.5 group/name"
                title={nickname?.trim() ? `Custom name (real: ${league.name})` : undefined}
              >
                <span className="truncate">{displayName}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDraft(nickname || ''); setEditing(true); }}
                    className="text-white/30 hover:text-banana opacity-0 group-hover/name:opacity-100 transition-opacity flex-shrink-0"
                    aria-label="Rename team"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </h3>
            )}
            <span
              className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full flex-shrink-0 ${config.color}/20 ${config.text} ring-1 ring-current/20`}
            >
              {config.label}
            </span>
            <FounderPill draftId={league.id} size="sm" />
            {inTheMoney && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 flex-shrink-0 border border-green-500/20">
                Advancing
              </span>
            )}
            {isListed && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 flex-shrink-0 border border-green-500/20">
                Listed{typeof mt?.price === 'number' ? ` · $${mt.price.toFixed(0)}` : ''}
              </span>
            )}
          </div>

          {leagueNo != null && (
            <p className="text-white/40 text-xs font-mono -mt-1.5 mb-3">League #{leagueNo}</p>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Rank</p>
              <p className="text-white font-bold text-lg">
                {showRank ? (
                  <>{formatRank(league.leagueRank)}<span className="text-white/30 font-normal text-xs ml-0.5">of 10</span></>
                ) : '-'}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Weekly</p>
              <p className="text-white/80 font-semibold text-lg">
                {seasonStarted ? formatScore(league.weeklyScore) : '-'}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Season</p>
              <p className="text-banana font-bold text-lg">
                {seasonStarted ? formatScore(league.seasonScore) : '-'}
              </p>
            </div>
          </div>

          {/* Rank progress bar */}
          {showRank && (
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
          <div className="flex items-center gap-2 flex-wrap">
            {actionButtons.map(({ tab, label, icon }) => (
              <button
                key={tab}
                onClick={() => onOpenModal(league, tab)}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.06] text-white/50 hover:text-white/80 text-xs font-medium transition-colors"
              >
                {icon}
                {label}
                {tab === 'chat' && unreadCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b30] text-white text-[10px] font-bold flex items-center justify-center shadow-md"
                    aria-label={`${unreadCount} unread messages`}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* View card lightbox — the obsidian team card at full size + download. */}
      {showCard && mt?.imageUrl && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-sm"
          onClick={() => setShowCard(false)}
        >
          <button
            type="button"
            onClick={() => setShowCard(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/[0.08] hover:bg-white/[0.16] flex items-center justify-center text-white/70"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
          <div className="relative w-auto h-[78vh] aspect-[4/5] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
            <Image src={mt.imageUrl} alt={`Team #${mt.tokenId}`} fill className="object-contain rounded-2xl" sizes="92vw" />
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void downloadCard(); }}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-banana text-black text-sm font-semibold hover:brightness-110 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            Download
          </button>
        </div>
      )}
    </div>
  );
}
