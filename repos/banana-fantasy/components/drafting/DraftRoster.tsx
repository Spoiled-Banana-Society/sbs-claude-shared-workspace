'use client';

import React, { useState, useEffect } from 'react';
import { POSITION_COLORS, ALL_POSITIONS } from '@/lib/draftRoomConstants';
import type { PositionRoster, DraftPick } from '@/lib/draftRoomConstants';
import type { DraftPlayer } from '@/hooks/useDraftEngine';

interface DraftRosterProps {
  draftOrder: DraftPlayer[];
  rosters: Record<string, PositionRoster>;
  picks: DraftPick[];
  userDraftPosition: number;
  initialPlayer?: string; // Pre-select a specific player's roster
  userProfilePicture?: string;
  userName?: string;
}

const POSITION_KEYS: (keyof PositionRoster)[] = ['QB', 'RB', 'WR', 'TE', 'DST'];

export function DraftRoster({ draftOrder, rosters, picks, userDraftPosition, initialPlayer, userProfilePicture, userName }: DraftRosterProps) {
  const [selectedPlayer, setSelectedPlayer] = useState(
    initialPlayer || draftOrder[userDraftPosition]?.name || draftOrder[0]?.name || ''
  );

  // When a different player card is clicked, update selection
  useEffect(() => {
    if (initialPlayer) setSelectedPlayer(initialPlayer);
  }, [initialPlayer]);

  const roster = rosters[selectedPlayer];

  // Find the display name for the selected player
  const selectedDraftPlayer = draftOrder.find(p => p.name === selectedPlayer);
  const rawName = selectedDraftPlayer?.isYou && userName
    ? userName
    : selectedDraftPlayer?.displayName || selectedDraftPlayer?.name || selectedPlayer;
  // Shorten wallet addresses: 0xd330...9362
  const displayName = rawName.startsWith('0x') && rawName.length > 12
    ? `${rawName.slice(0, 6)}...${rawName.slice(-4)}`
    : rawName;

  // Count players per position
  const positionCounts: Record<string, number> = {};
  for (const pos of POSITION_KEYS) {
    positionCounts[pos] = roster?.[pos]?.length || 0;
  }

  // Get pick info for a player ID
  const getPickInfo = (playerId: string) => {
    return picks.find(p => p.playerId === playerId);
  };

  const getPlayerData = (playerId: string) => {
    return ALL_POSITIONS.find(p => p.playerId === playerId);
  };

  return (
    <div className="px-3 pt-5 w-full lg:w-[900px] mx-auto">
      {/* Dropdown selector */}
      <select
        value={selectedPlayer}
        onChange={e => setSelectedPlayer(e.target.value)}
        className="font-primary font-bold w-full bg-[#1a1a24] border border-white/10 px-4 py-3 text-white text-sm focus:outline-none focus:border-banana/50 appearance-none cursor-pointer"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\' fill=\'none\'%3E%3Cpath d=\'M1 1.5L6 6.5L11 1.5\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
          backgroundSize: '12px',
        }}
      >
        {draftOrder.map(p => {
          const label = p.isYou ? 'Your Team' : p.displayName || p.name;
          const shortLabel = label.startsWith('0x') && label.length > 12
            ? `${label.slice(0, 6)}...${label.slice(-4)}`
            : label;
          return (
            <option key={p.id} value={p.name} className="bg-[#1a1a24] font-bold">
              {shortLabel}
            </option>
          );
        })}
      </select>

      {/* ===== RosterItemComponent ===== */}

      {/* Header section */}
      <div style={{ paddingTop: 30 }}>
        {/* Profile photo */}
        {selectedDraftPlayer?.isYou && userProfilePicture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={userProfilePicture} alt="You" style={{ width: 40, height: 40, borderRadius: '50%', margin: '10px auto', border: '1px solid #777', objectFit: 'cover' }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/banana-profile.png" alt="Player" style={{ width: 40, height: 40, borderRadius: '50%', margin: '10px auto', border: '1px solid #777' }} />
        )}

        {/* Display name */}
        <div
          style={{
            textAlign: 'center',
            fontWeight: 'bold',
            color: '#fff',
            fontSize: 22,
          }}
        >
          {displayName}
        </div>

        {/* Position counts row */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 15,
          }}
        >
          {POSITION_KEYS.map(pos => {
            const color = POSITION_COLORS[pos] || '#888';
            return (
              <div key={pos}>
                <div className="font-primary font-bold" style={{ color, textAlign: 'center' }}>
                  {pos}
                </div>
                <div
                  style={{
                    textAlign: 'center',
                    fontWeight: 'bold',
                    color: '#fff',
                    fontSize: 18,
                  }}
                >
                  {positionCounts[pos]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Column headers row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          marginTop: 40,
          borderBottom: '1px solid #666',
          paddingBottom: 25,
          padding: '7px 0 25px 10px',
        }}
      >
        <div style={{ flex: 7 }} />
        <div
          style={{
            flex: 1,
            color: '#ccc',
            textTransform: 'uppercase',
            fontSize: 14,
            fontWeight: 'bold',
            textAlign: 'right',
          }}
        >
          BYE
        </div>
        <div
          style={{
            flex: 1,
            color: '#ccc',
            textTransform: 'uppercase',
            fontSize: 14,
            fontWeight: 'bold',
            textAlign: 'right',
          }}
        >
          ADP
        </div>
        <div
          style={{
            flex: 1,
            color: '#ccc',
            textTransform: 'uppercase',
            fontSize: 14,
            fontWeight: 'bold',
            textAlign: 'right',
          }}
        >
          PICK
        </div>
      </div>

      {/* Position sections */}
      <div style={{ paddingBottom: 150 }}>
        {POSITION_KEYS.map(pos => {
          const color = POSITION_COLORS[pos] || '#888';
          const players = roster?.[pos] || [];

          return (
            <div
              key={pos}
              className="item-container"
              style={{ borderBottom: '1px solid #666', paddingBottom: 25 }}
            >
              {/* Position label */}
              <div
                className="font-primary font-bold"
                style={{
                  fontSize: 21,
                  paddingTop: 20,
                  paddingBottom: 5,
                  color,
                }}
              >
                {pos}
              </div>

              {/* Players or empty state */}
              {players.length === 0 ? (
                <div className="my-5" style={{ color: '#fff' }}>
                  --
                </div>
              ) : (
                players.map(playerId => {
                  const pickInfo = getPickInfo(playerId);
                  const playerData = getPlayerData(playerId);

                  return (
                    <div
                      key={playerId}
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'nowrap',
                        justifyContent: 'flex-end',
                        padding: '7px 0 0 10px',
                        marginBottom: 10,
                        borderLeft: `2px solid ${color}`,
                      }}
                    >
                      {/* Player ID */}
                      <div
                        style={{
                          flex: 7,
                          color: '#fff',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          fontSize: 16,
                        }}
                      >
                        {playerId}
                      </div>

                      {/* BYE */}
                      <div
                        style={{
                          flex: 1,
                          color: '#fff',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          fontSize: 13,
                          textAlign: 'right',
                        }}
                      >
                        {playerData?.byeWeek || '--'}
                      </div>

                      {/* ADP */}
                      <div
                        style={{
                          flex: 1,
                          color: '#fff',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          fontSize: 13,
                          textAlign: 'right',
                        }}
                      >
                        {playerData?.adp || '--'}
                      </div>

                      {/* PICK */}
                      <div
                        style={{
                          flex: 1,
                          color: '#fff',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          fontSize: 13,
                          textAlign: 'right',
                        }}
                      >
                        {pickInfo?.pickNumber || '--'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
