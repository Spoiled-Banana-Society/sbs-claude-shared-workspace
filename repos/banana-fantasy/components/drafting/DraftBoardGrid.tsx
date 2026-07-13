'use client';

import React, { useRef } from 'react';
import { getPositionColorHex, TOTAL_ROUNDS } from '@/lib/draftRoomConstants';
import type { DraftSummarySlot } from '@/hooks/useDraftEngine';
import type { DraftPlayer } from '@/hooks/useDraftEngine';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import type { DraftRoomUsersMap } from '@/hooks/useDraftRoomUsers';
import { getTruncatedAccountName } from '@/utils/helpers';
import { useSelfPfp } from '@/hooks/useSelfPfp';

interface DraftBoardGridProps {
  draftOrder: DraftPlayer[];
  draftSummary: DraftSummarySlot[];
  currentPickNumber: number;
  userDraftPosition: number;
  onViewRoster: (playerName: string) => void;
  usersMap?: DraftRoomUsersMap;
  userProfilePicture?: string;
  userEquippedBadge?: string | null;
  userRipeness?: import('@/types').Ripeness | null;
  /** The current user's own board label — their custom name or default
   *  "Banana####". Shown on their column instead of the word "You". */
  userDisplayName?: string;
}

export function DraftBoardGrid({
  draftOrder,
  draftSummary,
  currentPickNumber: _currentPickNumber,
  userDraftPosition,
  onViewRoster,
  usersMap,
  userProfilePicture,
  userEquippedBadge,
  userRipeness,
  userDisplayName,
}: DraftBoardGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Durable self avatar: prefer the live auth pfp, then the polled usersMap
  // entry for our own slot, then the last-known-good pfp persisted to
  // localStorage. Survives Privy rehydration + mobile tab backgrounding, so
  // our own avatar never blanks out to the banana once we've seen it once.
  const selfPlayer = draftOrder.find((p) => p?.isYou);
  const selfMapImageUrl = selfPlayer?.name
    ? usersMap?.[selfPlayer.name.toLowerCase()]?.imageUrl
    : undefined;
  const selfPfp = useSelfPfp(userProfilePicture, selfMapImageUrl);

  // Chunk picks into rounds of 10
  const rounds: DraftSummarySlot[][] = [];
  for (let r = 0; r < TOTAL_ROUNDS; r++) {
    const start = r * 10;
    const roundSlots = draftSummary.slice(start, start + 10);
    // Snake: reverse odd-indexed groups (index 1, 3, 5... = even rounds 2, 4, 6...)
    if (r % 2 === 1) {
      rounds.push([...roundSlots].reverse());
    } else {
      rounds.push(roundSlots);
    }
  }

  // Get first 10 items from draftSummary for headings (owner names)
  const headings = draftSummary.slice(0, 10);

  return (
    <div
      ref={gridRef}
      className="font-primary"
      style={{
        // width:100% keeps the horizontal scroll INSIDE this div on phones.
        // Without it, `margin: 0 auto` cancels the flex-stretch sizing, the
        // grid renders at its intrinsic ~1120px, and the PARENT tab container
        // pans instead — dragging the Draft/Queue/Board tab row off-screen
        // (Richard, 2026-07-05: end-slot drafters had to scroll the whole
        // board back left just to reach the Draft tab).
        width: '100%',
        maxWidth: 1200,
        margin: '0 auto',
        padding: 10,
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Header row: owner names.
          Fixed 110px tracks (cell is 100px wide + 10px horizontal margin) so
          the grid keeps its intrinsic ~1100px width. On a phone the parent's
          overflow:auto then scrolls horizontally instead of collapsing the
          1fr columns down to ~37px and overlapping every cell. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 110px)',
          width: 'max-content',
        }}
      >
        {headings.map((slot, idx) => {
          const isUser = slot.ownerIndex === userDraftPosition;
          const player = draftOrder[idx];
          const resolvedUser = !player?.isYou && player?.name
            ? usersMap?.[player.name.toLowerCase()]
            : null;
          const displayLabel = player
            ? (player.isYou
                ? (userDisplayName || 'You')
                : getTruncatedAccountName(resolvedUser?.displayName || player.name, player.name))
            : slot.ownerName;

          const avatarUrl = player?.isYou
            ? (selfPfp || '/banana-profile.png')
            : (resolvedUser?.imageUrl || '/banana-profile.png');
          const badge = player?.isYou
            ? userEquippedBadge
            : (resolvedUser?.equippedBadge ?? null);
          const ripeness = player?.isYou
            ? userRipeness
            : (resolvedUser?.ripeness ?? null);

          return (
            <div
              key={`heading-${idx}`}
              style={{
                width: 100,
                marginTop: 25,
                padding: 5,
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: 12,
                fontFamily: "'Montserrat', Arial, sans-serif",
                color: isUser ? '#F3E216' : '#fff',
                overflow: 'hidden',
                boxSizing: 'content-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AvatarWithBadge
                imageUrl={avatarUrl}
                alt={displayLabel}
                size={32}
                equippedBadge={badge}
                ripeness={ripeness}
                useNextImage={false}
                className=""
              />
              <div
                style={{
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid cells - each round is a row */}
      {rounds.map((roundSlots, roundIdx) => (
        <div
          key={roundIdx}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(10, 110px)',
            width: 'max-content',
          }}
        >
          {roundSlots.map((slot) => {
            const isPicked = slot.playerId !== '';
            const isUserPick = slot.ownerIndex === userDraftPosition;
            const hexColor = isPicked ? getPositionColorHex(slot.position) : '';

            const borderColor = isUserPick && isPicked
              ? '#F3E216'
              : isPicked
                ? hexColor
                : 'transparent';

            const bgColor = isPicked ? hexColor : '#333';

            return (
              <div
                key={slot.pickNum}
                onClick={() => isPicked && onViewRoster(slot.ownerName)}
                style={{
                  width: 100,
                  height: 80,
                  margin: '7px 5px',
                  padding: 5,
                  borderRadius: 5,
                  backgroundColor: bgColor,
                  border: `3px solid ${borderColor}`,
                  display: 'flex',
                  flexFlow: 'column nowrap',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  cursor: isPicked ? 'pointer' : 'default',
                  transition: 'transform 0.15s ease, filter 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (isPicked) {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.filter = 'brightness(2)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.filter = 'brightness(1)';
                }}
              >
                {isPicked ? (
                  <>
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 'bold',
                        fontFamily: "'Montserrat', Arial, sans-serif",
                        color: '#000',
                        textAlign: 'left',
                        lineHeight: 1.2,
                      }}
                    >
                      {slot.playerId}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 'bold',
                        fontFamily: "'Montserrat', Arial, sans-serif",
                        color: '#000',
                        textAlign: 'left',
                      }}
                    >
                      R{slot.round} P{slot.pickNum}
                    </span>
                  </>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 'bold',
                      fontFamily: "'Montserrat', Arial, sans-serif",
                      color: 'rgba(255,255,255,0.2)',
                      textAlign: 'left',
                    }}
                  >
                    R{roundIdx + 1} P{slot.pickNum}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
