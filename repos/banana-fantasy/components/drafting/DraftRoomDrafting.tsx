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
import { getTruncatedAccountName, bananaDefaultName } from '@/utils/helpers';
import {
  getPositionColorHex,
  POSITION_COLORS,
  ALL_POSITIONS,
} from '@/lib/draftRoomConstants';
import type { DraftType, RoomPhase } from '@/lib/draftRoomConstants';
import { draftBandBackground, draftBandShadow, draftStatusColor } from '@/lib/draftBandStyle';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import type { DraftRoomUsersMap } from '@/hooks/useDraftRoomUsers';
import { useSelfPfp } from '@/hooks/useSelfPfp';
import { UserPopover } from '@/components/social/UserPopover';

interface UserLike {
  username?: string | null;
  profilePicture?: string | null;
  equippedBadge?: string | null;
  ripeness?: import('@/types').Ripeness | null;
}

interface DraftRoomDraftingProps {
  engine: ReturnType<typeof useDraftEngine>;
  phase: RoomPhase;
  visibleDraftType: DraftType | null;
  mainCountdown: number;
  bestTimeRemaining: number;
  /** True when this is a slow draft (8h picks with an overnight pause). */
  isSlowDraft?: boolean;
  /** True when the slow-draft clock is currently paused (22:00–05:00 PT). */
  isSlowDraftPaused?: boolean;
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
  sortPreference?: 'adp' | 'rank';
  userRankMap?: Map<string, number>;
  userStatsMap?: Map<string, { rank?: number; adp?: number; byeWeek?: number }>;
  showBanner?: boolean;
  /** Spectator mode — viewer is not in the draft. Replaces user-centric
   *  copy ("Your turn", "My Team") with drafter-aware copy and points
   *  the sidebar at whichever drafter the user clicked on. */
  spectator?: boolean;
  usersMap?: DraftRoomUsersMap;
}

export function DraftRoomDrafting({
  engine,
  phase,
  visibleDraftType,
  mainCountdown,
  bestTimeRemaining,
  isSlowDraft = false,
  isSlowDraftPaused = false,
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
  sortPreference,
  userRankMap,
  userStatsMap,
  showBanner = true,
  spectator = false,
  usersMap,
}: DraftRoomDraftingProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Unread draft-room-chat messages, surfaced as a small badge on the Chat tab.
  // Driven entirely by DraftRoomChat (which is always mounted + polling); reset
  // to 0 whenever the Chat tab is the active tab.
  const [chatUnread, setChatUnread] = useState(0);

  // Durable self avatar: live auth pfp → polled usersMap (our slot) →
  // last-known-good pfp persisted in localStorage. Keeps our own avatar from
  // blanking to the banana during Privy rehydration or after a mobile tab is
  // backgrounded (both live sources go briefly empty there).
  const selfPlayer = engine.draftOrder.find((p) => p?.isYou);
  const selfMapImageUrl = selfPlayer?.name
    ? usersMap?.[selfPlayer.name.toLowerCase()]?.imageUrl
    : undefined;
  const selfPfp = useSelfPfp(user?.profilePicture, selfMapImageUrl);

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

  // ⌘\ / Ctrl+\ — macOS/Finder standard for sidebar toggle. Skip when an
  // input/textarea is focused so it doesn't fight the chat composer.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      setSidebarOpen(prev => !prev);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
      {/* New HOF/JP look: the gold/red lives on the top BANNER (below),
          and the drafting area stays clean/dark — so the old full-screen
          radial halo during drafting was removed. The dramatic reveal
          halo still plays pre-draft (see DraftRoomReveal). */}

      {/* Founder pill is rendered at the draft-room page level (z-[70])
          so it persists across all phases — see app/draft-room/page.tsx. */}

      {showBanner && engine.draftStatus !== 'completed' && (
        <>
          <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{
        background: draftBandBackground(visibleDraftType),
        boxShadow: draftBandShadow(visibleDraftType),
        // Drop the type-colored band + player strip below the notch on iOS
        // (viewportFit:'cover'). Without this the colored top + PRO/HOF word
        // hide under the status bar — looked "unsynced" on mobile (Boris 2026-06-13).
        paddingTop: 'env(safe-area-inset-top)',
      }}>
            <div
              ref={bannerRef}
              className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar"
              style={{ marginTop: '15px' }}
            >
              {engine.draftSummary.map((slot) => {
                const isPicked = slot.playerId !== '';
                // A picked slot can NEVER render as "current" — at the final
                // pick (and briefly on every pick between landing and advance)
                // both were true, stacking the current-pick clock border +
                // position-needs row ON TOP of the picked-card border + player
                // name. That's the "lines over the boxes" glitch during the
                // 1s final-pick reveal hold.
                const isCurrent = slot.pickNum === engine.currentPickNumber && !isPicked;
                const isUpcoming = slot.pickNum > engine.currentPickNumber;
                const isUserCard = slot.ownerIndex === engine.userDraftPosition;
                const posHex = isPicked ? getPositionColorHex(slot.position) : '';
                const counts = getPositionCountsForPlayer(slot.ownerName);
                const borderColor = isUserCard ? '#F3E216' : isCurrent ? '#fff' : '#444';
                // New look: cards stay dark on every draft type; "you" is the
                // gold border + gold pfp ring. So text is always white.
                const textColor = '#fff';

                const playerData = engine.draftOrder[slot.ownerIndex];
                const playerUser = !isUserCard && playerData?.name
                  ? usersMap?.[playerData.name.toLowerCase()]
                  : null;
                const otherPfp = playerUser?.imageUrl || '/banana-profile.png';
                const otherBadge = playerUser?.equippedBadge ?? null;
                const otherRipeness = playerUser?.ripeness ?? null;
                // A drafter is friend/message-able only if it's a real user
                // (live-mode name is their wallet, starts with 0x) and not you.
                // Bots (name `bot-…`) and empty slots are skipped.
                const friendWallet = !isUserCard && playerData?.name?.toLowerCase().startsWith('0x')
                  ? playerData.name
                  : null;
                let displayName = '';
                if (playerData) {
                  if (playerData.isYou) {
                    displayName = (user?.username && !user.username.startsWith('0x')) ? user.username : 'You';
                  } else if (playerUser?.displayName) {
                    displayName = playerUser.displayName;
                  } else {
                    displayName = getTruncatedAccountName(playerData.name || playerData.displayName || '', playerData.name || '');
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
                      background: '#222',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.borderColor = '#fff'; }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#222';
                      e.currentTarget.style.borderColor = borderColor;
                    }}
                    onClick={() => onViewRoster(slot.ownerName)}
                  >
                    <div>
                      {isUserCard ? (
                        <div className="flex justify-center">
                          <AvatarWithBadge
                            // Durable self pfp (see useSelfPfp at top): live auth
                            // pfp → polled usersMap → localStorage cache, so it
                            // never blanks to the banana on reload / mobile.
                            imageUrl={selfPfp || '/banana-profile.png'}
                            alt="You"
                            size={48}
                            equippedBadge={user?.equippedBadge}
                            ripeness={user?.ripeness}
                            useNextImage={false}
                            ringClassName="border-2 border-[#F3E216]"
                          />
                        </div>
                      ) : friendWallet ? (
                        // Tapping a real drafter's avatar opens the friend /
                        // message popover. stopPropagation in UserPopover keeps
                        // this from also firing the card's view-roster click.
                        <div className="flex justify-center">
                          <UserPopover walletAddress={friendWallet} username={displayName} pfpUrl={otherPfp}>
                            <AvatarWithBadge
                              imageUrl={otherPfp}
                              alt={displayName}
                              size={48}
                              equippedBadge={otherBadge}
                              ripeness={otherRipeness}
                              useNextImage={false}
                              className="cursor-pointer hover:ring-2 hover:ring-banana/50 transition-all"
                            />
                          </UserPopover>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <AvatarWithBadge
                            imageUrl={otherPfp}
                            alt={displayName}
                            size={48}
                            equippedBadge={otherBadge}
                            ripeness={otherRipeness}
                            useNextImage={false}
                            className=""
                          />
                        </div>
                      )}

                      <div className="mt-2 font-bold text-[11px] lg:text-[14px] font-primary" style={{ color: textColor }}>
                        {truncatedName}
                      </div>

                      {isCurrent && engine.draftStatus !== 'completed' ? (
                        isSlowDraftPaused ? (
                          // Paused overnight: still show the (frozen) time
                          // remaining, with a small pause marker below it.
                          <div style={{ margin: '2px auto 0px auto', textAlign: 'center' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'rgba(255,255,255,0.85)' }}>
                              {formatTime(bestTimeRemaining)}
                            </div>
                            <div style={{ fontWeight: 600, fontSize: '10px', color: '#fbbf24', marginTop: '1px' }}>
                              ⏸ Paused · 5am PT
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            fontWeight: 'bold',
                            fontSize: '16px',
                            margin: '2px auto 0px auto',
                            textAlign: 'center',
                            color: bestTimeRemaining > 10 ? '#fff' : 'red',
                          }}>
                            {formatTime(bestTimeRemaining)}
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 2, paddingBottom: 3 }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: textColor, opacity: 0.7 }}>R{slot.round}</span>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: textColor, opacity: 0.7 }}>P{slot.pickNum}</span>
                        </div>
                      )}

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
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%' }}>
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

            <div className="grow text-center uppercase text-sm font-bold px-3 pt-2 mt-3 font-primary" style={{ color: draftStatusColor(visibleDraftType) }}>
              {spectator ? (
                (() => {
                  const onClockIdx = engine.draftSummary.find(s => s.pickNum === engine.currentPickNumber)?.ownerIndex;
                  const onClockName = onClockIdx !== undefined
                    ? getTruncatedAccountName(
                        engine.draftOrder[onClockIdx]?.displayName || engine.draftOrder[onClockIdx]?.name || '',
                        engine.draftOrder[onClockIdx]?.name || '',
                      )
                    : '';
                  const truncated = onClockName.length > 14
                    ? `${onClockName.substring(0, 12)}…`
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
              ) : engine.currentPickNumber && engine.currentPickNumber > 0 ? (
                // Draft is mid-pick (someone on the clock) but the user
                // has no more picks of their own. Don't fall through to
                // 'Draft starting in 0:00' — that's misleading. Show
                // the actual state: other players finishing up.
                <span className="text-white/60">Other players finishing the draft…</span>
              ) : (
                <span className="text-white/70">Draft starting in {formatTime(mainCountdown)}</span>
              )}
            </div>

            {isSlowDraft && (
              isSlowDraftPaused ? (
                <div className="text-center text-[12px] mt-1 px-3 text-white/65">
                  ⏸ Clock paused until 5am PT — you can still make picks
                </div>
              ) : (
                <div className="text-center text-[12px] mt-1 px-3 text-white/65">
                  Clock pauses daily 10pm–5am PT · you can still make picks
                </div>
              )
            )}

            {controls}
          </div>

          {/* Spacer reserves the space under the position:fixed banner above.
              The banner's content (~290px) sits flush against this. For the
              colored draft types (jackpot/HOF) the banner has a red/gold
              background, so a flush edge makes the colored bar visually touch
              the tab menu below it — add a little extra height so a clean black
              gap separates them. Black drafts need no gap (black-on-black). */}
          <div style={{ height: `calc(${(visibleDraftType === 'jackpot' || visibleDraftType === 'hof') ? '310px' : '290px'} + env(safe-area-inset-top))`, flexShrink: 0, backgroundColor: '#000' }} />
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {(() => {
          const isCompleted = phase === 'drafting' && engine.draftStatus === 'completed';
          return (
          <div className="flex flex-1 overflow-hidden">
            {/* Main tab content (left) — tabs centered above player list */}
            <div className="relative flex-1 overflow-auto flex flex-col min-w-0">
              {/* Draft completion screen — generates the team card and
                  redirects to /draft-results. Rendered as a full overlay over
                  the content area so it shows regardless of which tab the user
                  happens to be on when the final pick lands. Previously this was
                  gated behind `activeTab === 'draft'`, so a user sitting on any
                  other tab (queue/board/roster/chat) at draft completion never
                  saw the card and was never redirected. The underlying tabs stay
                  mounted (chat polling/history persists) until the redirect. */}
              {isCompleted && (
                <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black pb-12">
                  <DraftComplete
                    draftId={draftId || urlDraftId}
                    generatedCardUrl={generatedCardUrl}
                    walletAddress={walletParam}
                    draftType={visibleDraftType}
                    roster={engine.picks
                      .filter(p => (p.ownerName || '').toLowerCase() === (walletParam || '').toLowerCase())
                      .map(p => ({ playerId: p.playerId, position: p.position, pick: p.pickNumber }))}
                  />
                </div>
              )}
              <DraftTabs
                activeTab={activeTab}
                onTabChange={onTabChange}
                queueCount={engine.queuedPlayers.length}
                chatUnread={chatUnread}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(prev => !prev)}
              />
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
                  sortPreference={sortPreference}
                  userRankMap={userRankMap}
                  userStatsMap={userStatsMap}
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
                  usersMap={usersMap}
                  userProfilePicture={user?.profilePicture ?? undefined}
                  userEquippedBadge={user?.equippedBadge}
                  userRipeness={user?.ripeness}
                  userDisplayName={
                    (user?.username && !user.username.startsWith('0x'))
                      ? user.username
                      : bananaDefaultName(walletParam || '')
                  }
                />
              )}
              {activeTab === 'roster' && (
                <DraftRoster
                  draftOrder={engine.draftOrder}
                  rosters={engine.rosters}
                  picks={engine.picks}
                  playerStatsById={engine.playerStatsById}
                  userDraftPosition={engine.userDraftPosition}
                  initialPlayer={rosterViewPlayer}
                  userProfilePicture={user?.profilePicture ?? undefined}
                  userName={user?.username ?? undefined}
                  userEquippedBadge={user?.equippedBadge}
                  userRipeness={user?.ripeness}
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
                  isActive={activeTab === 'chat'}
                  onUnreadChange={setChatUnread}
                />
              </div>
            </div>

            {/* Right sidebar: Queue + My Team previews (desktop only).
                Toggle lives in the top tab row (Show/Hide Panel button)
                — no edge rail. ⌘\ / Ctrl+\ also toggles. */}
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
                  <span className="text-[10px] text-white/30 normal-case tracking-normal font-medium">View →</span>
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
                    ? getTruncatedAccountName(engine.draftOrder[viewedIdx]?.displayName || viewedName || '', viewedName || '').slice(0, 14)
                    : 'My Team';
                  return (
                <>
                <button
                  onClick={() => onTabChange('roster')}
                  className="flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors flex-shrink-0"
                >
                  <span>{teamLabel} ({teamCount}/15)</span>
                  <span className="text-[10px] text-white/30 normal-case tracking-normal font-medium">View →</span>
                </button>
                <div className="flex-1 overflow-y-auto pb-2">
                  {(() => {
                    const userRoster = engine.rosters[viewedName];
                    const positionKeys = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;
                    // Build a lookup for pick details (bye, adp, pick#).
                    // ADP/bye come from engine.playerStatsById — the LIVE server
                    // values (same source as the available list + results page),
                    // which include already-picked players. Fall back to the
                    // static ALL_POSITIONS only if the live map lacks the id
                    // (e.g. before the server payload arrives). This is the fix
                    // for the roster panel showing a stale hardcoded ADP.
                    const pickLookup: Record<string, { bye: number; adp: number; pick: number }> = {};
                    for (const p of engine.picks) {
                      if (p.ownerIndex === engine.userDraftPosition) {
                        const live = engine.playerStatsById?.[p.playerId];
                        const player = ALL_POSITIONS.find(ap => ap.playerId === p.playerId);
                        pickLookup[p.playerId] = {
                          bye: live?.byeWeek ?? player?.byeWeek ?? 0,
                          adp: live?.adp ?? player?.adp ?? player?.rank ?? 0,
                          pick: p.pickNumber || 0,
                        };
                      }
                    }
                    return (
                      <div>
                        {/* Column headers — flush left with rows below */}
                        <div className="flex items-center text-[9px] text-white/30 uppercase tracking-[0.12em] px-3 pb-1">
                          <span className="flex-1">Player</span>
                          <span className="w-7 text-right tabular-nums">Bye</span>
                          <span className="w-7 text-right tabular-nums">ADP</span>
                          <span className="w-8 text-right tabular-nums">Pick</span>
                        </div>
                        {positionKeys.map(pos => {
                          const players = userRoster ? ((userRoster as unknown as Record<string, string[]>)[pos] || []) : [];
                          const posColor = POSITION_COLORS[pos] || '#888';
                          return (
                            <div key={pos} className="mt-2 first:mt-1">
                              {/* Position header — flush left, colored hairline underline anchors the section */}
                              <div
                                className="flex items-center justify-between px-3 py-1 mb-0.5 border-b"
                                style={{ borderBottomColor: `${posColor}26` }}
                              >
                                <span
                                  className="text-[10px] font-bold uppercase tracking-[0.18em]"
                                  style={{ color: posColor }}
                                >
                                  {pos}
                                </span>
                              </div>
                              {players.length === 0 ? (
                                <div className="text-white/20 text-xs px-3 py-0.5">—</div>
                              ) : (
                                players.map(playerId => {
                                  const info = pickLookup[playerId];
                                  return (
                                    <div key={playerId} className="flex items-center text-xs py-1 px-3 hover:bg-white/[0.02] transition-colors">
                                      <span className="text-white/85 truncate flex-1 font-medium tracking-tight">{playerId}</span>
                                      <span className="text-white/60 w-7 text-right text-[10px] tabular-nums">{info?.bye || '—'}</span>
                                      <span className="text-white/60 w-7 text-right text-[10px] tabular-nums">{info?.adp || '—'}</span>
                                      <span className="text-white/60 w-8 text-right text-[10px] tabular-nums">{info?.pick || '—'}</span>
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
