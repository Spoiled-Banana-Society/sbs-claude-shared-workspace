'use client';

import React, { useEffect, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { DraftRoomChat } from '@/components/drafting/DraftRoomChat';
import { DraftTabs } from '@/components/drafting/DraftTabs';
import type { DraftTab } from '@/components/drafting/DraftTabs';
import { DraftPlayerList } from '@/components/drafting/DraftPlayerList';
import { DraftQueue } from '@/components/drafting/DraftQueue';
import { DraftBoardGrid } from '@/components/drafting/DraftBoardGrid';
import { DraftRoster } from '@/components/drafting/DraftRoster';
import { DraftComplete } from '@/components/drafting/DraftComplete';
import {
  getPositionColorHex,
  POSITION_COLORS,
  ALL_POSITIONS,
} from '@/lib/draftRoomConstants';
import type { DraftType, RoomPhase } from '@/lib/draftRoomConstants';
import { useDraftEngine } from '@/hooks/useDraftEngine';

interface UserLike {
  username?: string | null;
  profilePicture?: string | null;
}

interface DraftRoomDraftingProps {
  engine: ReturnType<typeof useDraftEngine>;
  phase: RoomPhase;
  visibleDraftType: DraftType | null;
  mainCountdown: number;
  bestTimeRemaining: number;
  formatTime: (seconds: number) => string;
  activeTab: DraftTab;
  onTabChange: (tab: DraftTab) => void;
  draftId: string;
  urlDraftId: string;
  generatedCardUrl: string | null;
  walletParam: string;
  playerCount: number;
  user?: UserLike | null;
  controls?: React.ReactNode;
  bannerRef: React.RefObject<HTMLDivElement>;
  onViewRoster: (playerName: string) => void;
  rosterViewPlayer?: string;
  onDraftPlayer: (playerId: string) => void;
  onQueueSync: (queue: ReturnType<typeof useDraftEngine>['queuedPlayers']) => void;
  onSortChange: (sort: 'adp' | 'rank') => void;
  showBanner?: boolean;
  /** Spectator mode — viewer is not in the draft. Replaces user-centric
   *  copy ("Your turn", "My Team") with drafter-aware copy and points
   *  the sidebar at whichever drafter the user clicked on. */
  spectator?: boolean;
}

export function DraftRoomDrafting({
  engine,
  phase,
  visibleDraftType,
  mainCountdown,
  bestTimeRemaining,
  formatTime,
  activeTab,
  onTabChange,
  draftId,
  urlDraftId,
  generatedCardUrl,
  walletParam,
  playerCount,
  user,
  controls,
  bannerRef,
  onViewRoster,
  rosterViewPlayer,
  onDraftPlayer,
  onQueueSync,
  onSortChange,
  showBanner = true,
  spectator = false,
}: DraftRoomDraftingProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('draftRoom:sidebarOpen');
      if (saved === 'false') setSidebarOpen(false);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('draftRoom:sidebarOpen', String(sidebarOpen));
    } catch {}
  }, [sidebarOpen]);

  const getPositionCountsForPlayer = (playerName: string) => {
    const roster = engine.rosters[playerName];
    if (!roster) return { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
    return {
      QB: roster.QB?.length ?? 0,
      RB: roster.RB?.length ?? 0,
      WR: roster.WR?.length ?? 0,
      TE: roster.TE?.length ?? 0,
      DST: roster.DST?.length ?? 0,
    };
  };

  return (
    <>
      {/* JP/HOF tint behind the drafting view. Same gradient as the
          DraftRoomReveal pulse-glow so the red/yellow background carries
          through from reveal into drafting (was disappearing the moment
          the slot machine resolved into 'drafting' phase). */}
      {(visibleDraftType === 'jackpot' || visibleDraftType === 'hof') && engine.draftStatus !== 'completed' && (
        <div
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            background: visibleDraftType === 'jackpot'
              ? 'radial-gradient(circle at center, rgba(239, 68, 68, 0.18) 0%, transparent 70%)'
              : 'radial-gradient(circle at center, rgba(255, 215, 0, 0.18) 0%, transparent 70%)',
          }}
        />
      )}

      {/* Founder pill is rendered at the draft-room page level (z-[70])
          so it persists across all phases — see app/draft-room/page.tsx. */}

      {showBanner && engine.draftStatus !== 'completed' && (
        <>
          <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{ backgroundColor: '#000' }}>
            <div
              ref={bannerRef}
              className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar"
              style={{ marginTop: '15px' }}
            >
              {engine.draftSummary.map((slot) => {
                const isPicked = slot.playerId !== '';
                const isCurrent = slot.pickNum === engine.currentPickNumber;
                const isUpcoming = slot.pickNum > engine.currentPickNumber;
                const isUserCard = slot.ownerIndex === engine.userDraftPosition;
                const posHex = isPicked ? getPositionColorHex(slot.position) : '';
                const counts = getPositionCountsForPlayer(slot.ownerName);
                const borderColor = isUserCard ? '#F3E216' : isCurrent ? '#fff' : '#444';
                const textColor = visibleDraftType === 'hof' && isUserCard ? '#111'
                  : visibleDraftType === 'jackpot' && isUserCard ? '#222'
                  : '#fff';

                const playerData = engine.draftOrder[slot.ownerIndex];
                let displayName = '';
                if (playerData) {
                  if (playerData.isYou) {
                    displayName = (user?.username && !user.username.startsWith('0x')) ? user.username : 'You';
                  } else {
                    const raw = playerData.name || playerData.displayName || '';
                    displayName = raw.length > 14 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : raw;
                  }
                } else {
                  displayName = slot.ownerName || '';
                }

                const truncatedName = displayName.length > 14 ? `${displayName.substring(0, 12)}...` : displayName;

                return (
                  <div
                    key={slot.pickNum}
                    data-pick={slot.pickNum}
                    className="flex-shrink-0 text-center overflow-hidden cursor-pointer"
                    style={{
                      minWidth: 'clamp(100px, 12vw, 140px)',
                      flex: 1,
                      padding: '10px 0 0 0',
                      borderRadius: '5px',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor,
                      transition: 'all 0.25s ease-in-out',
                      background: isUserCard
                        ? (visibleDraftType === 'hof' ? '#F3E216' : visibleDraftType === 'jackpot' ? '#FF474C' : '#222')
                        : '#222',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.borderColor = '#fff'; }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isUserCard
                        ? (visibleDraftType === 'hof' ? '#F3E216' : visibleDraftType === 'jackpot' ? '#FF474C' : '#222')
                        : '#222';
                      e.currentTarget.style.borderColor = borderColor;
                    }}
                    onClick={() => onViewRoster(slot.ownerName)}
                  >
                    <div>
                      {isUserCard && user?.profilePicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.profilePicture} alt="You" className="rounded-full w-[30px] h-[30px] mx-auto border border-gray-500 object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/banana-profile.png" alt="Banana" className="rounded-full w-[30px] mx-auto h-[30px] border border-gray-500" />
                      )}

                      {isCurrent && engine.draftStatus !== 'completed' ? (
                        <div style={{
                          fontWeight: 'bold',
                          fontSize: '18px',
                          margin: '5px auto 0px auto',
                          textAlign: 'center',
                          color: bestTimeRemaining > 10 ? '#fff' : (visibleDraftType === 'jackpot' ? 'yellow' : 'red'),
                        }}>
                          {formatTime(bestTimeRemaining)}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 5, paddingBottom: 3 }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>R{slot.round}</span>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>P{slot.pickNum}</span>
                        </div>
                      )}

                      <div className="lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary" style={{ color: textColor }}>
                        {truncatedName}
                      </div>

                      {isUpcoming && (
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                          {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                            <div
                              key={pos}
                              style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: POSITION_COLORS[pos], textAlign: 'center' }}
                            >
                              <p style={{ fontSize: '10px' }}>{pos}</p>
                              <p className="text-xs">{counts[pos]}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {isCurrent && (
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%', minHeight: '54px' }}>
                          <p className="font-primary text-[15px] font-bold italic text-center pt-2" style={{ color: textColor }}>
                            Picking...
                          </p>
                        </div>
                      )}
                      {isPicked && (
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: posHex, width: '100%', height: '55px' }}>
                          <p className="font-primary" style={{ fontWeight: 800, fontSize: 15, textAlign: 'center', paddingTop: 5, color: textColor }}>
                            {slot.playerId}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grow text-center uppercase text-sm font-bold px-3 pt-2 mt-3 font-primary">
              {spectator ? (
                (() => {
                  const onClockIdx = engine.draftSummary.find(s => s.pickNum === engine.currentPickNumber)?.ownerIndex;
                  const onClockName = onClockIdx !== undefined
                    ? (engine.draftOrder[onClockIdx]?.displayName || engine.draftOrder[onClockIdx]?.name || '')
                    : '';
                  const truncated = onClockName.length > 14
                    ? `${onClockName.slice(0, 6)}…${onClockName.slice(-4)}`
                    : onClockName;
                  return (
                    <span className="text-white/80">
                      On the clock: <span className="text-yellow-400">{truncated || '—'}</span>
                      <span className="ml-3 text-white/40">Pick {engine.currentPickNumber} / 150</span>
                    </span>
                  );
                })()
              ) : engine.isUserTurn && engine.airplaneMode ? (
                <span className="flex items-center justify-center gap-2 text-emerald-400">
                  Auto-drafting...
                </span>
              ) : engine.isUserTurn ? (
                'Your turn to draft!'
              ) : engine.airplaneMode && engine.turnsUntilUserPick > 0 ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="text-emerald-400">Auto-draft ON</span>
                  <span className="text-white/60">· {engine.turnsUntilUserPick} turn(s) away</span>
                </span>
              ) : engine.turnsUntilUserPick > 0 ? (
                `${engine.turnsUntilUserPick} turn(s) until your pick!`
              ) : (
                <span className="text-white/70">Draft starting in {formatTime(mainCountdown)}</span>
              )}
            </div>

            {controls}
          </div>

          <div style={{ height: '290px', flexShrink: 0, backgroundColor: '#000' }} />
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {(() => {
          const isCompleted = phase === 'drafting' && engine.draftStatus === 'completed';
          return (
          <div className="flex flex-1 overflow-hidden">
            {/* Main tab content (left) — tabs centered above player list */}
            <div className="flex-1 overflow-auto flex flex-col min-w-0">
              <DraftTabs activeTab={activeTab} onTabChange={onTabChange} queueCount={engine.queuedPlayers.length} />
              {activeTab === 'draft' && isCompleted && (
                <DraftComplete
                  draftId={draftId || urlDraftId}
                  generatedCardUrl={generatedCardUrl}
                  walletAddress={walletParam}
                />
              )}
              {activeTab === 'draft' && !isCompleted && (
                <DraftPlayerList
                  availablePlayers={engine.availablePlayers}
                  isUserTurn={phase === 'drafting' && engine.isUserTurn}
                  onDraft={onDraftPlayer}
                  onAddToQueue={(player) => {
                    engine.addToQueue(player);
                    const newQueue = [...engine.queuedPlayers, player];
                    if (phase === 'drafting') onQueueSync(newQueue);
                  }}
                  onRemoveFromQueue={(playerId) => {
                    engine.removeFromQueue(playerId);
                    const newQueue = engine.queuedPlayers.filter(p => p.playerId !== playerId);
                    if (phase === 'drafting') onQueueSync(newQueue);
                  }}
                  isInQueue={engine.isInQueue}
                  onSortChange={onSortChange}
                />
              )}
              {activeTab === 'queue' && (
                <DraftQueue
                  queuedPlayers={engine.queuedPlayers}
                  availablePlayers={engine.availablePlayers}
                  isUserTurn={phase === 'drafting' && engine.isUserTurn}
                  onDraft={onDraftPlayer}
                  onRemoveFromQueue={(playerId) => {
                    engine.removeFromQueue(playerId);
                    const newQueue = engine.queuedPlayers.filter(p => p.playerId !== playerId);
                    if (phase === 'drafting') onQueueSync(newQueue);
                  }}
                  onReorderQueue={(newOrder) => {
                    engine.reorderQueue(newOrder);
                    if (phase === 'drafting') onQueueSync(newOrder);
                  }}
                />
              )}
              {activeTab === 'board' && (
                <DraftBoardGrid
                  draftOrder={engine.draftOrder}
                  draftSummary={engine.draftSummary}
                  currentPickNumber={engine.currentPickNumber}
                  userDraftPosition={engine.userDraftPosition}
                  onViewRoster={onViewRoster}
                />
              )}
              {activeTab === 'roster' && (
                <DraftRoster
                  draftOrder={engine.draftOrder}
                  rosters={engine.rosters}
                  picks={engine.picks}
                  userDraftPosition={engine.userDraftPosition}
                  initialPlayer={rosterViewPlayer}
                  userProfilePicture={user?.profilePicture ?? undefined}
                  userName={user?.username ?? undefined}
                />
              )}
              {/* Keep chat mounted across tab switches and through draft
                  completion so the polling subscription, unread counter, and
                  message history persist. Visibility is CSS-controlled — the
                  parent div is `hidden` when another tab is active. */}
              <div hidden={activeTab !== 'chat'} className={activeTab === 'chat' ? 'flex-1 flex flex-col min-h-0' : ''}>
                <DraftRoomChat
                  playerCount={playerCount}
                  phase={phase}
                  username={user?.username ?? undefined}
                  draftId={draftId}
                  walletAddress={walletParam}
                />
              </div>
            </div>

            {/* Right sidebar: Queue + My Team previews (desktop only) */}
            {/* Toggle button (always visible) */}
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="hidden xl:flex flex-col items-center justify-center w-8 flex-shrink-0 bg-white/[0.04] hover:bg-white/[0.1] text-white/50 hover:text-white text-sm transition-colors border-l border-white/[0.08] cursor-pointer gap-2"
              title={sidebarOpen ? 'Hide queue & team' : 'Show queue & team'}
              aria-label={sidebarOpen ? 'Hide queue & team' : 'Show queue & team'}
            >
              <span className="text-base leading-none">{sidebarOpen ? '›' : '‹'}</span>
              {!sidebarOpen && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  Queue · My Team
                </span>
              )}
            </button>
            <div className={`hidden xl:flex flex-col flex-shrink-0 border-l border-white/[0.06] overflow-hidden transition-all duration-200 ${sidebarOpen ? 'w-72' : 'w-0 border-l-0'}`}>
              {/* Queue preview — compact, just enough for the list */}
              {(() => {
                const draftedIds = new Set(engine.picks.map(p => p.playerId));
                const activeQueue = engine.queuedPlayers.filter(p => !draftedIds.has(p.playerId));
                return (
              <div className="flex flex-col border-b border-white/[0.06]" style={{ maxHeight: '30%' }}>
                <button
                  onClick={() => onTabChange('queue')}
                  className="flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors flex-shrink-0"
                >
                  <span>Queue {activeQueue.length > 0 ? `(${activeQueue.length})` : ''}</span>
                  <span className="text-[10px] text-white/30">View full →</span>
                </button>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                  {activeQueue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/20 text-xs text-center px-4">
                      <span className="text-2xl mb-2">⭐</span>
                      <p>Add players from the list to set your pick order</p>
                    </div>
                  ) : (
                    <DragDropContext onDragEnd={(result: DropResult) => {
                      if (!result.destination) return;
                      const items = [...activeQueue];
                      const [reordered] = items.splice(result.source.index, 1);
                      items.splice(result.destination.index, 0, reordered);
                      engine.reorderQueue(items);
                      if (phase === 'drafting') onQueueSync(items);
                    }}>
                      <Droppable droppableId="sidebar-queue">
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                            {activeQueue.map((player, i) => (
                              <Draggable key={player.playerId} draggableId={`sq-${player.playerId}`} index={i}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-grab active:cursor-grabbing select-none ${
                                      snapshot.isDragging ? 'bg-white/10 shadow-lg' : 'bg-white/[0.03] hover:bg-white/[0.06]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-white/20 text-[10px] flex-shrink-0">⠿</span>
                                      <span className="text-white/30 w-4 text-center flex-shrink-0">{i + 1}</span>
                                      <span className="text-white/80 font-medium truncate">{player.playerId}</span>
                                    </div>
                                    <span className="text-white/30 flex-shrink-0 ml-2">#{player.rank}</span>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  )}
                </div>
              </div>
                );
              })()}

              {/* My Team preview — in spectator mode, this follows the
                  clicked drafter (or current drafter as default) since the
                  viewer doesn't have a team. */}
              <div className="flex-1 min-h-0 flex flex-col">
                {(() => {
                  let viewedIdx = engine.userDraftPosition;
                  let viewedName = engine.draftOrder[engine.userDraftPosition]?.name || '';
                  if (spectator) {
                    const fromClicked = rosterViewPlayer
                      ? engine.draftOrder.findIndex(d => d.name === rosterViewPlayer || d.displayName === rosterViewPlayer)
                      : -1;
                    const fromOnClock = engine.draftSummary.find(s => s.pickNum === engine.currentPickNumber)?.ownerIndex ?? -1;
                    viewedIdx = fromClicked >= 0 ? fromClicked : (fromOnClock >= 0 ? fromOnClock : 0);
                    viewedName = engine.draftOrder[viewedIdx]?.name || '';
                  }
                  const teamCount = engine.picks.filter(p => p.ownerIndex === viewedIdx).length;
                  const teamLabel = spectator
                    ? (engine.draftOrder[viewedIdx]?.displayName || viewedName || 'Team').slice(0, 14)
                    : 'My Team';
                  return (
                <>
                <button
                  onClick={() => onTabChange('roster')}
                  className="flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors flex-shrink-0"
                >
                  <span>{teamLabel} ({teamCount}/15)</span>
                  <span className="text-[10px] text-white/30">View full →</span>
                </button>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                  {(() => {
                    const userRoster = engine.rosters[viewedName];
                    const positionKeys = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
                    // Build a lookup for pick details (bye, adp, pick#) from static data
                    // Use ALL_POSITIONS (never mutated) instead of engine.availablePlayers (which removes picked players)
                    const pickLookup: Record<string, { bye: number; adp: number; pick: number }> = {};
                    for (const p of engine.picks) {
                      if (p.ownerIndex === engine.userDraftPosition) {
                        const player = ALL_POSITIONS.find(ap => ap.playerId === p.playerId);
                        pickLookup[p.playerId] = {
                          bye: player?.byeWeek || 0,
                          adp: player?.adp || player?.rank || 0,
                          pick: p.pickNumber || 0,
                        };
                      }
                    }
                    return (
                      <div className="space-y-2">
                        {/* Column headers */}
                        <div className="flex items-center text-[9px] text-white/30 uppercase tracking-wider px-2">
                          <span className="flex-1">Player</span>
                          <span className="w-7 text-center">Bye</span>
                          <span className="w-7 text-center">ADP</span>
                          <span className="w-7 text-center">Pick</span>
                        </div>
                        {positionKeys.map(pos => {
                          const players = userRoster ? ((userRoster as unknown as Record<string, string[]>)[pos] || []) : [];
                          const posColor = POSITION_COLORS[pos] || '#888';
                          return (
                            <div key={pos}>
                              <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: posColor }}>{pos}</div>
                              {players.length === 0 ? (
                                <div className="text-white/15 text-xs pl-2">--</div>
                              ) : (
                                players.map(playerId => {
                                  const info = pickLookup[playerId];
                                  return (
                                    <div key={playerId} className="flex items-center text-xs py-0.5 pl-2">
                                      <span className="text-white/70 truncate flex-1">{playerId}</span>
                                      <span className="text-white/30 w-7 text-center text-[10px]">{info?.bye || '-'}</span>
                                      <span className="text-white/30 w-7 text-center text-[10px]">{info?.adp || '-'}</span>
                                      <span className="text-white/40 w-7 text-center text-[10px] font-medium">{info?.pick || '-'}</span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
                </>
                  );
                })()}
              </div>
            </div>
          </div>
          );
        })()}
      </div>
    </>
  );
}
