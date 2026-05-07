'use client';

import React from 'react';
import { DRAFT_PLAYERS } from '@/lib/draftRoomConstants';
import type { DraftType } from '@/lib/draftRoomConstants';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';

type DraftRoomPlayer = typeof DRAFT_PLAYERS[number];

interface UserLike {
  username?: string | null;
  profilePicture?: string | null;
  equippedBadge?: string | null;
}

interface DraftRoomFillingProps {
  draftOrder: DraftRoomPlayer[];
  playerCount: number;
  waitingForServer: boolean;
  isRandomizingFromStore: boolean;
  serverWaitProgress: number;
  randomizingProgressFromStore: number;
  user?: UserLike | null;
  visibleDraftType: DraftType | null;
  controls?: React.ReactNode;
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
}: DraftRoomFillingProps) {
  const isRandomizing = waitingForServer || isRandomizingFromStore;
  const randomizingProgress = Math.max(serverWaitProgress, randomizingProgressFromStore);
  const myName = user?.username && !user.username.startsWith('0x') ? user.username : 'You';

  return (
    <>
      <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{ backgroundColor: '#000' }}>
        <div className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar" style={{ marginTop: '15px' }}>
          {Array.from({ length: 10 }, (_, i) => {
            const player = draftOrder[i];
            const isUser = player?.isYou ?? false;
            const isFilled = isRandomizing ? true : (isUser || i < playerCount);
            const borderColor = isUser ? '#F3E216' : isFilled ? '#444' : '#333';
            const hasWalletData = player && !player.isYou && player.name && player.name.length > 10;

            let displayName = '';
            if (isRandomizing) {
              displayName = isUser ? myName : (hasWalletData ? `${player!.name.slice(0, 6)}...${player!.name.slice(-4)}` : `Player ${i + 1}`);
            } else if (isFilled) {
              displayName = isUser ? myName : `Player ${i + 1}`;
            } else {
              displayName = '---';
            }

            const truncatedName = displayName.length > 14 ? `${displayName.substring(0, 12)}...` : displayName;
            const bgColor = isUser && isFilled
              ? (visibleDraftType === 'hof' ? '#F3E216' : visibleDraftType === 'jackpot' ? '#FF474C' : '#222')
              : '#222';
            const textColor = isUser && visibleDraftType === 'hof' ? '#111'
              : isUser && visibleDraftType === 'jackpot' ? '#222'
              : '#fff';

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
                  {isUser ? (
                    <div className="flex justify-center">
                      <AvatarWithBadge
                        imageUrl={user?.profilePicture || '/banana-profile.png'}
                        alt="You"
                        size={30}
                        equippedBadge={user?.equippedBadge}
                        useNextImage={false}
                        className="border border-gray-500"
                      />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/banana-profile.png"
                      alt="Banana"
                      className={`rounded-full w-[30px] mx-auto h-[30px] border border-gray-500 ${!isFilled ? 'animate-pulse' : ''}`}
                      style={{ opacity: isFilled ? 1 : 0.4 }}
                    />
                  )}

                  <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 5, paddingBottom: 3 }}>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: isFilled ? textColor : '#444' }}>#{i + 1}</span>
                  </div>

                  <div className={`lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary ${isRandomizing && !isUser ? 'animate-pulse' : ''}`} style={{ color: isFilled ? (isUser ? (visibleDraftType ? textColor : '#F3E216') : textColor) : '#444' }}>
                    {truncatedName}
                  </div>

                  {!isFilled ? (
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
              <span className="text-2xl font-black tabular-nums">{playerCount}/10</span>
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
