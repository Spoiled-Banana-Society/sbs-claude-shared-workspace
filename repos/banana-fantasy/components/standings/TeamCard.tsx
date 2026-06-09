'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import type { League } from '@/types';
import type { MarketplaceTeam } from '@/lib/opensea';
import type { ModalTab } from './LeagueDetailModal';
import { useUnreadChatCount } from '@/hooks/useUnreadChatCount';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';

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
  jackpot: { label: 'Jackpot', pill: 'bg-jackpot', border: 'border-red-500/30', bg: 'bg-gradient-to-b from-red-500/[0.06] to-transparent', text: 'text-jackpot' },
  hof: { label: 'HOF', pill: 'bg-hof', border: 'border-[#D4AF37]/30', bg: 'bg-gradient-to-b from-[#D4AF37]/[0.06] to-transparent', text: 'text-hof' },
  pro: { label: 'Pro', pill: 'bg-pro', border: 'border-purple-500/25', bg: 'bg-white/[0.02]', text: 'text-pro' },
  regular: { label: 'Pro', pill: 'bg-pro', border: 'border-purple-500/25', bg: 'bg-white/[0.02]', text: 'text-pro' },
};

export function TeamCard({ league, onOpenModal, index = 0, nickname, onRename, walletAddress, marketplaceTeam }: TeamCardProps) {
  const unreadCount = useUnreadChatCount(league.id, walletAddress);

  const mt = marketplaceTeam;
  const isListed = !!mt?.orderHash;

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

  const teamLabel = mt?.tokenId ? `Team #${mt.tokenId}` : league.name;
  const displayName = nickname?.trim() || teamLabel;
  const leagueNo = mt?.leagueNumber ?? (league.name.match(/#\s*(\d+)/)?.[1] ?? null);

  const commit = () => { if (onRename) { void onRename(league.id, draft); } setEditing(false); };
  const cancel = () => { setDraft(nickname || ''); setEditing(false); };

  const config = typeConfig[league.type] || typeConfig.regular;
  const isCompleted = league.status === 'completed';

  const actionButtons: { tab: ModalTab; label: string; icon: React.ReactNode }[] = [
    {
      tab: 'roster', label: 'Roster',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      tab: 'board', label: 'Board',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      tab: 'chat', label: 'Chat',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={`animate-card-enter rounded-2xl overflow-hidden border transition-all duration-200 ${isCompleted ? 'opacity-80' : ''} ${config.border} ${config.bg}`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Obsidian team card image — the hero. Tap → full-screen view. */}
      <div className="relative aspect-[4/5] bg-[#0d0d12]">
        {mt?.fillingWheelLevel ? (
          // Wheel-won JP/HOF pass still filling: gold HOF / red Jackpot pass art.
          <Image
            src={buildTieredDraftPassUrl(mt.tokenId, mt.fillingWheelLevel)}
            alt={`${mt.fillingWheelLevel === 'jackpot' ? 'Jackpot' : 'HOF'} Pass #${mt.tokenId}`}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, 50vw"
            priority={index < 4}
            loading={index < 4 ? undefined : 'lazy'}
          />
        ) : mt?.imageUrl ? (
          <Image
            src={mt.imageUrl}
            alt={`Team #${mt.tokenId}`}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, 50vw"
            // Preload the above-the-fold cards (first 2 rows of the 2-up grid)
            // so they paint immediately instead of lazy-loading on scroll.
            priority={index < 4}
            loading={index < 4 ? undefined : 'lazy'}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-widest ${config.text}`}>{config.label}</span>
            <span className="text-white/80 font-mono text-base">{mt?.tokenId ? `Team #${mt.tokenId}` : 'Team'}</span>
          </div>
        )}

        {/* Tier badge top-left (+ Listed indicator if on sale) */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 pointer-events-none">
          <span className={`text-[9px] font-bold uppercase tracking-wider text-white px-2.5 py-1 rounded-full ${config.pill}`}>{config.label}</span>
          {isListed && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-green-400 bg-green-500/15 border border-green-500/25 px-2 py-1 rounded-full">
              Listed{typeof mt?.price === 'number' ? ` $${mt.price.toFixed(2)}` : ''}
            </span>
          )}
        </div>

        {/* Direct download — no need to open the card first */}
        {mt?.imageUrl && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void downloadCard(); }}
            className="absolute top-2.5 right-2.5 z-20 w-8 h-8 rounded-full text-white/70 hover:text-white hover:bg-black/40 flex items-center justify-center transition-colors"
            aria-label="Download card image"
            title="Download card"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          </button>
        )}
      </div>

      {/* Info strip: Team # (left) · League # (right) */}
      <div className="px-4 pt-3.5 pb-1 flex items-center justify-between gap-2 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') cancel(); }}
            onBlur={commit}
            placeholder={teamLabel}
            className="bg-bg-elevated text-white text-base px-2 py-0.5 rounded border border-banana/40 outline-none focus:border-banana min-w-0 flex-1"
          />
        ) : (
          <h3 className="text-white font-mono font-bold text-base sm:text-[17px] truncate flex items-center gap-1.5 group/name min-w-0">
            <span className="truncate">{displayName}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => { setDraft(nickname || ''); setEditing(true); }}
                className="text-white/30 hover:text-banana opacity-0 group-hover/name:opacity-100 transition-opacity flex-shrink-0"
                aria-label="Rename team"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
          </h3>
        )}
        {leagueNo != null && (
          <span className="text-white/40 text-xs font-mono flex-shrink-0">League #{leagueNo}</span>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 pt-2 flex items-center gap-2">
        {actionButtons.map(({ tab, label, icon }) => (
          <button
            key={tab}
            onClick={() => onOpenModal(league, tab)}
            className="relative flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-white/55 hover:text-white/85 text-xs font-medium transition-colors"
          >
            {icon}
            {label}
            {tab === 'chat' && unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b30] text-white text-[10px] font-bold flex items-center justify-center shadow-md" aria-label={`${unreadCount} unread messages`}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

    </div>
  );
}
