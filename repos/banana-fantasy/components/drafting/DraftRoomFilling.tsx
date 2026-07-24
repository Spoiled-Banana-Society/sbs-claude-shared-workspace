'use client';

import React from 'react';
import { DRAFT_PLAYERS } from '@/lib/draftRoomConstants';
import { shouldShowPlayerCount } from '@/lib/draftRoomLobby';
import type { DraftType } from '@/lib/draftRoomConstants';
import { draftBandBackground, draftBandShadow } from '@/lib/draftBandStyle';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import LiveDraftActivityLine from '@/components/drafting/LiveDraftActivityLine';
import type { DraftRoomUsersMap } from '@/hooks/useDraftRoomUsers';
import { bananaPlaceholderName } from '@/utils/helpers';

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
  /** The logged-in user's wallet — used to resolve their OWN lobby avatar via
   *  the server-clean usersMap (banana fallback) instead of a raw web2 pfp URL. */
  userWallet?: string;
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
  userWallet,
  visibleDraftType,
  controls,
  usersMap,
}: DraftRoomFillingProps) {
  // The user's OWN server-clean avatar (banana fallback). web2/Gmail logins
  // expose a raw Google pfp URL on `user.profilePicture` that can render a
  // glitchy/blank image during filling — prefer the same usersMap source the
  // other players use so the self box shows the banana consistently.
  const selfImageUrl = usersMap?.[userWallet?.toLowerCase() ?? '']?.imageUrl || user?.profilePicture || '/banana-profile.png';
  const isRandomizing = waitingForServer || isRandomizingFromStore;
  const randomizingProgress = Math.max(serverWaitProgress, randomizingProgressFromStore);
  const myName = user?.username && !user.username.startsWith('0x') ? user.username : 'You';

  // Original lobby box sizing (kept as named constants; the boxes are fine —
  // the gap below them is a spacer issue, fixed by the measurement below).
  const avatarSize = 48;
  const statMinH = 54;
  const boxPadTop = 10;
  const rowMarginTop = 15;

  // Spacer below the position:fixed lobby header. It must land the tabs at the
  // SAME spot as the drafting phase, which reserves 290px (310 for JP/HOF) via
  // the IDENTICAL calc in DraftRoomDrafting. The earlier `- 3.5rem` made this
  // spacer SMALLER than drafting's, so the tabs crowded up against the lobby
  // header (which is actually TALLER than the drafting banner — it carries the
  // "N/10 waiting" line + EXIT/MUTE/OFF controls). Matching drafting's reserve
  // exactly gives the tabs the same breathing room in both phases on desktop
  // and mobile (safe-area included on both sides, so it cancels).
  const fillingSpacer = `calc(${(visibleDraftType === 'jackpot' || visibleDraftType === 'hof' || visibleDraftType === 'jackhof') ? '310px' : '290px'} - 2.5rem + env(safe-area-inset-top))`;

  return (
    <>
      {/* Type-colored band behind the box strip — SAME treatment as the
          drafting phase (DraftRoomDrafting): gold for HOF, red for Jackpot.
          The lobby used to keep the old design (solid-color user box, no
          band), so wheel-won JP/HOF drafts looked stale while filling
          (caught by Boris on 2025-slow-draft-62, 2026-06-10). */}
      <div className="fixed top-0 left-0 z-[55] w-full overflow-hidden font-primary" style={{
        background: draftBandBackground(visibleDraftType),
        boxShadow: draftBandShadow(visibleDraftType),
        // Match DraftRoomDrafting — drop the strip below the notch on iOS
        // (viewportFit:'cover'), else the top of the lobby hides under the
        // status bar on mobile (Boris 2026-06-13).
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <div className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar" style={{ marginTop: `${rowMarginTop}px` }}>
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
                : (otherDisplayName || (hasWalletData ? bananaPlaceholderName(player!.name) : `Player ${i + 1}`));
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
                  padding: `${boxPadTop}px 0 0 0`,
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
                        imageUrl={selfImageUrl}
                        alt="You"
                        size={avatarSize}
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
                        size={avatarSize}
                        equippedBadge={otherBadge}
                        ripeness={otherRipeness}
                        useNextImage={false}
                        className=""
                      />
                    </div>
                  ) : showSkeleton ? (
                    <div className="animate-shimmer rounded-full mx-auto border border-white/10" style={{ width: avatarSize, height: avatarSize }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/banana-profile.png"
                      alt="Banana"
                      className="rounded-full mx-auto border border-gray-500 animate-pulse"
                      style={{ opacity: 0.4, width: avatarSize, height: avatarSize }}
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
                    <div style={{ minHeight: `${statMinH}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div className="animate-shimmer rounded h-[10px] w-[70%]" />
                    </div>
                  ) : !isFilled ? (
                    <div style={{ minHeight: `${statMinH}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="animate-pulse" style={{ fontSize: '12px', color: '#444' }}>Waiting...</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: `${statMinH}px`, color: textColor }}>
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

        {/* "Keep waiting" nudge — other drafts in progress + furthest round.
            Hidden when nothing's live or the flag is off. Not uppercase/bold
            like the count above, so wrap outside that styling context. */}
        {!isRandomizing && (
          <div className="flex justify-center normal-case mt-3">
            <LiveDraftActivityLine />
          </div>
        )}

        {controls}
      </div>

      {/* Spacer = the fixed header's measured height (offsetHeight already
          includes its safe-area padding), so the tabs sit flush below it with
          no over-reserved gap. Falls back to ~250px for the first paint /
          no-ResizeObserver before the measurement lands. */}
      <div className="shrink-0 bg-black" style={{ height: fillingSpacer }} />
    </>
  );
}
