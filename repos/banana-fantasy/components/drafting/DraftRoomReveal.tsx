'use client';

import React from 'react';
import { SlotMachineOverlay } from '@/components/drafting/SlotMachineOverlay';
import { DRAFT_PLAYERS, POSITION_COLORS } from '@/lib/draftRoomConstants';
import type { DraftType, RoomPhase } from '@/lib/draftRoomConstants';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import type { DraftRoomUsersMap } from '@/hooks/useDraftRoomUsers';
import { getTruncatedAccountName } from '@/utils/helpers';

type DraftRoomPlayer = typeof DRAFT_PLAYERS[number];

interface UserLike {
  username?: string | null;
  profilePicture?: string | null;
  equippedBadge?: string | null;
}

interface DraftRoomRevealProps {
  draftOrder: DraftRoomPlayer[];
  phase: RoomPhase;
  user?: UserLike | null;
  visibleDraftType: DraftType | null;
  mainCountdown: number;
  preSpinCountdown: number;
  formatTime: (seconds: number) => string;
  controls?: React.ReactNode;
  showFlash: boolean;
  confetti: Array<{ id: number; x: number; color: string; delay: number }>;
  jackpotRain: Array<{ id: number; x: number; delay: number; size: number }>;
  particleBurst: Array<{ id: number; x: number; y: number; angle: number; color: string }>;
  pulseGlow: boolean;
  specialTypeParam: 'jackpot' | 'hof' | null;
  showSlotMachine: boolean;
  allReelItems: DraftType[][];
  reelOffsets: number[];
  draftType: DraftType | null;
  slotAnimationDone: boolean;
  onCloseSlotMachine: () => void;
  /** Forwarded into the slot-machine overlay so the post-spin
   *  VerifiedBadge links to /proof/[draftId]. */
  draftId?: string;
  usersMap?: DraftRoomUsersMap;
}

export function DraftRoomReveal({
  draftOrder,
  phase,
  user,
  visibleDraftType,
  mainCountdown,
  preSpinCountdown,
  formatTime,
  controls,
  showFlash,
  confetti,
  jackpotRain,
  particleBurst,
  pulseGlow,
  specialTypeParam,
  showSlotMachine,
  allReelItems,
  reelOffsets,
  draftType,
  slotAnimationDone,
  onCloseSlotMachine,
  draftId,
  usersMap,
}: DraftRoomRevealProps) {
  const myName = user?.username && !user.username.startsWith('0x') ? user.username : 'You';

  return (
    <>
      {showFlash && <div className="fixed inset-0 z-50 bg-white/30 pointer-events-none animate-flash" />}

      {confetti.length > 0 && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {confetti.map((particle) => (
            <div
              key={particle.id}
              className="absolute animate-confetti"
              style={{
                left: `${particle.x}%`,
                backgroundColor: particle.color,
                animationDelay: `${particle.delay}s`,
                borderRadius: Math.random() > 0.5 ? '50%' : '0',
                width: `${8 + Math.random() * 8}px`,
                height: `${8 + Math.random() * 8}px`,
              }}
            />
          ))}
        </div>
      )}

      {particleBurst.length > 0 && (
        <div className="fixed inset-0 z-45 pointer-events-none overflow-hidden">
          {particleBurst.map((particle) => {
            const rad = (particle.angle * Math.PI) / 180;
            return (
              <div
                key={particle.id}
                className="absolute w-4 h-4 rounded-full animate-burst"
                style={{
                  left: `${particle.x}%`,
                  top: `${particle.y}%`,
                  backgroundColor: particle.color,
                  '--end-x': `${Math.cos(rad) * 400}px`,
                  '--end-y': `${Math.sin(rad) * 400}px`,
                  boxShadow: `0 0 10px ${particle.color}`,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}

      {/* Gold/red halo — visible during the pre-draft window (reveal +
          'Starting soon' countdown) so the HOF/JP drama carries through
          to the start. Cuts out the moment picks begin (phase==='drafting')
          so the drafting view is uncluttered. */}
      {visibleDraftType && (visibleDraftType === 'jackpot' || visibleDraftType === 'hof') && phase !== 'drafting' && phase !== 'completed' && (
        <div
          className="fixed inset-0 z-30 pointer-events-none animate-pulse-glow"
          style={{
            background: visibleDraftType === 'jackpot'
              ? 'radial-gradient(circle at center, rgba(239, 68, 68, 0.3) 0%, transparent 70%)'
              : 'radial-gradient(circle at center, rgba(255, 215, 0, 0.3) 0%, transparent 70%)',
          }}
        />
      )}

      {jackpotRain.length > 0 && visibleDraftType && (
        <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
          {jackpotRain.map((item) => (
            <div
              key={item.id}
              className={`absolute animate-jackpot-rain font-black italic ${visibleDraftType === 'jackpot' ? 'text-red-500' : 'text-yellow-400'}`}
              style={{
                left: `${item.x}%`,
                fontSize: `${item.size}px`,
                animationDelay: `${item.delay}s`,
                textShadow: visibleDraftType === 'jackpot'
                  ? '0 0 10px rgba(239, 68, 68, 0.8)'
                  : '0 0 10px rgba(250, 204, 21, 0.8)',
              }}
            >
              {visibleDraftType === 'jackpot' ? 'JACKPOT' : 'HOF'}
            </div>
          ))}
        </div>
      )}

      {/* HOF / JACKPOT HERO REVEAL — the "you hit something rare" moment.
          Rotating sun-rays behind a massive metallic-gradient title that
          slams in from huge scale with motion blur. Plays once for ~3.4s
          on the same gate as the pulse glow / specialType reveal. */}
      {((pulseGlow || (specialTypeParam && phase !== 'loading')) && visibleDraftType && (visibleDraftType === 'jackpot' || visibleDraftType === 'hof')) && (
        <div className="fixed inset-0 z-[70] pointer-events-none flex items-center justify-center overflow-hidden">
          <div
            className="absolute left-1/2 top-1/2 w-[200vmax] h-[200vmax] -translate-x-1/2 -translate-y-1/2 animate-hero-rays"
            style={{
              background: visibleDraftType === 'jackpot'
                ? 'repeating-conic-gradient(from 0deg, rgba(239,68,68,0.55) 0deg 6deg, transparent 6deg 24deg)'
                : 'repeating-conic-gradient(from 0deg, rgba(255,215,0,0.55) 0deg 6deg, transparent 6deg 24deg)',
              maskImage: 'radial-gradient(circle at center, transparent 8%, black 18%, black 55%, transparent 80%)',
              WebkitMaskImage: 'radial-gradient(circle at center, transparent 8%, black 18%, black 55%, transparent 80%)',
            }}
          />
          <div
            className="absolute left-1/2 top-1/2 animate-hero-slam font-black italic tracking-tighter text-center"
            style={{
              fontSize: 'clamp(80px, 18vw, 260px)',
              lineHeight: 1,
              background: visibleDraftType === 'jackpot'
                ? 'linear-gradient(180deg, #FFE0E0 0%, #FF4D4D 35%, #B91C1C 70%, #FFC2C2 100%)'
                : 'linear-gradient(180deg, #FFF6C2 0%, #FFD700 30%, #B8860B 65%, #FFE57F 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: visibleDraftType === 'jackpot'
                ? 'drop-shadow(0 0 36px rgba(239,68,68,0.95)) drop-shadow(0 6px 0 rgba(0,0,0,0.55))'
                : 'drop-shadow(0 0 36px rgba(255,215,0,0.95)) drop-shadow(0 6px 0 rgba(0,0,0,0.55))',
            }}
          >
            {visibleDraftType === 'jackpot' ? 'JACKPOT' : 'HOF'}
          </div>
          <div
            className="absolute left-1/2 top-[58%] animate-hero-subtitle font-bold text-center uppercase whitespace-nowrap"
            style={{
              fontSize: 'clamp(13px, 1.8vw, 22px)',
              color: visibleDraftType === 'jackpot' ? '#FFE5E5' : '#FFF8C2',
              textShadow: visibleDraftType === 'jackpot'
                ? '0 0 18px rgba(239,68,68,0.9), 0 2px 0 rgba(0,0,0,0.65)'
                : '0 0 18px rgba(255,215,0,0.9), 0 2px 0 rgba(0,0,0,0.65)',
            }}
          >
            {visibleDraftType === 'jackpot' ? 'Winner skips to the finals' : 'Hall of Fame — bonus prizes'}
          </div>
        </div>
      )}

      <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{ backgroundColor: visibleDraftType === 'hof' ? '#C9A227' : visibleDraftType === 'jackpot' ? '#C0282D' : '#000' }}>
        <div className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar" style={{ marginTop: '15px' }}>
          {Array.from({ length: 10 }, (_, i) => {
            const player = draftOrder[i];
            const isUser = player?.isYou ?? false;
            const playerUser = !isUser && player?.name ? usersMap?.[player.name.toLowerCase()] : null;
            const otherPfp = playerUser?.imageUrl || '/banana-profile.png';
            const otherBadge = playerUser?.equippedBadge ?? null;
            // Prefer the resolved username; otherwise an on-brand Banana #
            // default derived from the wallet — never a raw/truncated wallet.
            const displayName = player
              ? (player.isYou
                  ? myName
                  : (playerUser?.displayName || getTruncatedAccountName(player.name || '', player.name || '')))
              : '???';
            const truncatedName = displayName.length > 14 ? `${displayName.substring(0, 12)}...` : displayName;
            const showCountdown = i === 0;
            // New HOF/JP look: the gold/red lives on the BANNER, so every
            // card stays dark. "You" is the gold border + gold pfp ring.
            const bgColor = '#222';
            const textColor = '#fff';
            const tileBorder = isUser ? '#F3E216' : '#444';

            return (
              <div
                key={i}
                className="flex-shrink-0 text-center overflow-hidden cursor-pointer relative"
                style={{
                  minWidth: 'clamp(100px, 12vw, 140px)',
                  flex: 1,
                  padding: '10px 0 0 0',
                  borderRadius: '5px',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: tileBorder,
                  background: bgColor,
                }}
              >
                <div>
                  {isUser ? (
                    <div className="flex justify-center">
                      <AvatarWithBadge
                        imageUrl={user?.profilePicture || '/banana-profile.png'}
                        alt="You"
                        size={48}
                        equippedBadge={user?.equippedBadge}
                        useNextImage={false}
                        className="border-2 border-[#F3E216]"
                      />
                    </div>
                  ) : (
                    <div className="flex justify-center">
                      <AvatarWithBadge
                        imageUrl={otherPfp}
                        alt={displayName}
                        size={48}
                        equippedBadge={otherBadge}
                        useNextImage={false}
                        className="border border-gray-500"
                      />
                    </div>
                  )}

                  <div className="lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary" style={{ color: textColor }}>
                    {truncatedName}
                  </div>

                  {showCountdown ? (
                    <div style={{ fontWeight: 'bold', fontSize: '16px', margin: '2px auto 0px auto', textAlign: 'center', color: textColor }}>
                      {formatTime(mainCountdown)}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 2, paddingBottom: 3 }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: textColor, opacity: 0.7 }}>#{i + 1}</span>
                    </div>
                  )}

                  {showCountdown ? (
                    <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%', minHeight: '54px' }}>
                      <p className="font-primary text-[15px] font-bold italic text-center pt-2" style={{ color: '#4ade80' }}>
                        Starting soon!
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                      {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                        <div
                          key={pos}
                          style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: POSITION_COLORS[pos], textAlign: 'center', opacity: 0.5 }}
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
          {phase === 'pre-spin' ? (
            <span className={`flex items-center justify-center gap-2 ${visibleDraftType === 'hof' ? 'text-[#1a1400]' : 'text-yellow-400'}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${visibleDraftType === 'hof' ? 'bg-[#5a4708]' : 'bg-yellow-500'}`} />
              {<>Draft type reveal in {preSpinCountdown}s<span className={`ml-2 ${visibleDraftType === 'hof' ? 'text-black/40' : 'text-white/50'}`}>· Starting in {formatTime(mainCountdown)}</span></>}
            </span>
          ) : (
            <span className={visibleDraftType === 'hof' ? 'text-black/70' : 'text-white/70'}>Draft starting in {formatTime(mainCountdown)}</span>
          )}
        </div>

        {controls}
      </div>

      <div style={{ height: '290px', flexShrink: 0, backgroundColor: '#000' }} />

      {showSlotMachine && (
        <SlotMachineOverlay
          allReelItems={allReelItems}
          reelOffsets={reelOffsets}
          draftType={draftType}
          phase={phase}
          mainCountdown={mainCountdown}
          slotAnimationDone={slotAnimationDone}
          formatTime={formatTime}
          onClose={onCloseSlotMachine}
          draftId={draftId}
        />
      )}
    </>
  );
}
