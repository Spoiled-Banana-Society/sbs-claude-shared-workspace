'use client';

import React from 'react';
import { DRAFT_PLAYERS } from '@/lib/draftRoomConstants';
import { shouldShowPlayerCount } from '@/lib/draftRoomLobby';
import type { DraftType } from '@/lib/draftRoomConstants';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import type { DraftRoomUsersMap } from '@/hooks/useDraftRoomUsers';
import { bananaDefaultName } from '@/utils/helpers';

type DraftRoomPlayer = typeof DRAFT_PLAYERS[number];

interface UserLike {
  username?: string | null;
  profilePicture?: string | null;
  equippedBadge?: string | null;
  ripeness?: import('@/types').Ripeness | null;
}

interface DraftRoomFillingProps {
  draftOrder: DraftRoomPlayer[];
  /** null = count not known yet (show a pulse, never a false "1/10"). */
  playerCount: number | null;
  waitingForServer: boolean;
  isRandomizingFromStore: boolean;
  serverWaitProgress: number;
  randomizingProgressFromStore: number;
  user?: UserLike | null;
  visibleDraftType: DraftType | null;
  controls?: React.ReactNode;
  usersMap?: DraftRoomUsersMap;
}

export function DraftRoomFilling({
  draftOrder,
  playerCount,
  waitingForServer,
  isRandomizingFromStore,
  serverWaitProgress,
  randomizingProgressFromStore,
  user,
  visibleDraftType,
  controls,
  usersMap,
}: DraftRoomFillingProps) {
  const isRandomizing = waitingForServer || isRandomizingFromStore;
  const randomizingProgress = Math.max(serverWaitProgress, randomizingProgressFromStore);
  const myName = user?.username && !user.username.startsWith('0x') ? user.username : 'You';

  return (
    <>
      {/* Type-colored band behind the box strip — SAME treatment as the
          drafting phase (DraftRoomDrafting): gold for HOF, red for Jackpot.
          The lobby used to keep the old design (solid-color user box, no
          band), so wheel-won JP/HOF drafts looked stale while filling
          (caught by Boris on 2025-slow-draft-62, 2026-06-10). */}
      <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{ backgroundColor: visibleDraftType === 'hof' ? '#C9A227' : visibleDraftType === 'jackpot' ? '#C0282D' : '#000' }}>
        <div className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar" style={{ marginTop: '15px' }}>
          {Array.from({ length: 10 }, (_, i) => {
            const player = draftOrder[i];
            const isUser = player?.isYou ?? false;
            // During filling, fill boxes purely by the live count so all
            // joined players' boxes appear at the SAME moment. We must NOT
            // also force the user's own box (isUser) filled independently —
            // that made box 0 (you) show first, then the others trickle in by
            // count ("you, then the second person after"). isUser still drives
            // this box's highlight/avatar/name styling below; it just no
            // longer fills ahead of the count.
            const isFilled = isRandomizing ? true : i < (playerCount ?? 0);
            // While the count is still unknown (the brief gap before the join
            // response lands), show a polished shimmer "loading" placeholder in
            // every box instead of empty "Waiting…" slots — reads as the lobby
            // loading, not blank. Once the count is known, unfilled slots use
            // the normal "Waiting…" state.
            const showSkeleton = !isRandomizing && !isFilled && playerCount == null;
            const borderColor = isUser && isFilled ? '#F3E216' : isFilled ? '#444' : '#333';
            const hasWalletData = player && !player.isYou && player.name && player.name.length > 10;
            const playerUser = !isUser && player?.name ? usersMap?.[player.name.toLowerCase()] : null;
            const otherPfp = playerUser?.imageUrl || '/banana-profile.png';
            const otherBadge = playerUser?.equippedBadge ?? null;
            const otherRipeness = playerUser?.ripeness ?? null;
            const otherDisplayName = playerUser?.displayName || null;

            let displayName = '';
            if (isRandomizing) {
              displayName = isUser
                ? myName
                : (otherDisplayName || (hasWalletData ? bananaDefaultName(player!.name) : `Player ${i + 1}`));
            } else if (isFilled) {
              displayName = isUser ? myName : (otherDisplayName || `Player ${i + 1}`);
            } else {
              displayName = '---';
            }

            const truncatedName = displayName.length > 14 ? `${displayName.substring(0, 12)}...` : displayName;
            // Boxes stay DARK for every type — only YOUR box gets the yellow
            // ring (matches the drafting phase + Boris's design sketches).
            // The old solid gold/red fill on the user box is gone; the type
            // color now lives in the band behind the strip.
            const bgColor = '#222';
            const textColor = '#fff';

            return (
              <div
                key={i}
                className="flex-shrink-0 text-center overflow-hidden cursor-pointer"
                style={{
                  minWidth: 'clamp(100px, 12vw, 140px)',
                  flex: 1,
                  padding: '10px 0 0 0',
                  borderRadius: '5px',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor,
                  transition: 'all 0.4s ease-in-out',
                  background: isFilled ? bgColor : '#1a1a1a',
                }}
              >
                <div>
                  {isUser && isFilled ? (
                    <div className="flex justify-center">
                      <AvatarWithBadge
                        imageUrl={user?.profilePicture || '/banana-profile.png'}
                        alt="You"
                        size={48}
                        equippedBadge={user?.equippedBadge}
                        ripeness={user?.ripeness}
                        useNextImage={false}
                        className=""
                      />
                    </div>
                  ) : isFilled ? (
                    <div className="flex justify-center" style={{ opacity: 1 }}>
                      <AvatarWithBadge
                        imageUrl={otherPfp}
                        alt={otherDisplayName || 'Player'}
                        size={48}
                        equippedBadge={otherBadge}
                        ripeness={otherRipeness}
                        useNextImage={false}
                        className=""
                      />
                    </div>
                  ) : showSkeleton ? (
                    <div className="animate-shimmer rounded-full w-[48px] h-[48px] mx-auto border border-white/10" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/banana-profile.png"
                      alt="Banana"
                      className="rounded-full w-[48px] mx-auto h-[48px] border border-gray-500 animate-pulse"
                      style={{ opacity: 0.4 }}
                    />
                  )}

                  {showSkeleton ? (
                    <div className="mt-2 mx-auto animate-shimmer rounded h-[14px] w-[60%]" />
                  ) : (
                    <div className={`mt-2 font-bold text-[11px] lg:text-[14px] font-primary ${isRandomizing && !isUser ? 'animate-pulse' : ''}`} style={{ color: isFilled ? (isUser ? '#F3E216' : textColor) : '#444' }}>
                      {truncatedName}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 2, paddingBottom: 3 }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: isFilled ? textColor : '#444', opacity: 0.7 }}>#{i + 1}</span>
                  </div>

                  {showSkeleton ? (
                    <div style={{ minHeight: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div className="animate-shimmer rounded h-[10px] w-[70%]" />
                    </div>
                  ) : !isFilled ? (
                    <div style={{ minHeight: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="animate-pulse" style={{ fontSize: '12px', color: '#444' }}>Waiting...</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                      {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                        <div
                          key={pos}
                          style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: '#555', textAlign: 'center', opacity: 0.5 }}
                        >
                          <p style={{ fontSize: '10px' }}>{pos}</p>
                          <p className="text-xs">0</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grow text-center uppercase text-sm font-bold px-3 pt-2 mt-3 font-primary">
          {isRandomizing ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-xs mx-auto">
              <span className="text-white/70 text-xs tracking-widest uppercase">Randomizing Draft Order</span>
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden backdrop-blur-sm">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(randomizingProgress * 100)}%`,
                    background: randomizingProgress >= 1 ? '#4ade80' : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                  }}
                />
              </div>
              <span className="text-white/40 text-[10px]">{Math.round(randomizingProgress * 100)}%</span>
            </div>
          ) : (
            <span className="text-yellow-400">
              {shouldShowPlayerCount(playerCount) ? (
                <span className="text-2xl font-black tabular-nums">{playerCount}/10</span>
              ) : (
                // Count not known yet — a subtle pulse instead of a false "1/10".
                // The number fades in the instant the join response lands.
                <span
                  className="inline-block align-middle h-6 w-16 rounded bg-yellow-400/20 animate-pulse"
                  aria-hidden="true"
                />
              )}
              <span className="text-white/60 ml-2 text-sm">Waiting for players...</span>
            </span>
          )}
        </div>

        {controls}
      </div>

      <div style={{ height: '290px', flexShrink: 0, backgroundColor: '#000' }} />
    </>
  );
}
