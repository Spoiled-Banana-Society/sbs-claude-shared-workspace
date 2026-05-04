'use client';

import React, { useRef } from 'react';
import { getPositionColorHex, TOTAL_ROUNDS } from '@/lib/draftRoomConstants';
import type { DraftSummarySlot } from '@/hooks/useDraftEngine';
import type { DraftPlayer } from '@/hooks/useDraftEngine';

interface DraftBoardGridProps {
  draftOrder: DraftPlayer[];
  draftSummary: DraftSummarySlot[];
  currentPickNumber: number;
  userDraftPosition: number;
  onViewRoster: (playerName: string) => void;
}

export function DraftBoardGrid({
  draftOrder,
  draftSummary,
  currentPickNumber: _currentPickNumber,
  userDraftPosition,
  onViewRoster,
}: DraftBoardGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

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
        maxWidth: 1200,
        margin: '0 auto',
        padding: 10,
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Header row: owner names */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
        }}
      >
        {headings.map((slot, idx) => {
          const isUser = slot.ownerIndex === userDraftPosition;
          // Use display name from draftOrder if available, otherwise truncate ownerName
          const player = draftOrder[idx];
          const displayLabel = player
            ? (player.isYou
                ? (player.displayName || 'You')
                : (player.displayName || player.name))
            : slot.ownerName;

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
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                boxSizing: 'content-box',
              }}
            >
              {displayLabel}
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
            gridTemplateColumns: 'repeat(10, 1fr)',
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
