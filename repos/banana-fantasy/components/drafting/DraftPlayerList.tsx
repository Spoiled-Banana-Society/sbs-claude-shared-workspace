'use client';

import React, { useState, useMemo } from 'react';
import { getPositionColorHex, positionFromPlayerId, POSITION_COLORS } from '@/lib/draftRoomConstants';
import type { PlayerData } from '@/lib/draftRoomConstants';

interface DraftPlayerListProps {
  availablePlayers: PlayerData[];
  isUserTurn: boolean;
  onDraft: (playerId: string) => void;
  onAddToQueue: (player: PlayerData) => void;
  onRemoveFromQueue: (playerId: string) => void;
  isInQueue: (playerId: string) => boolean;
  onSortChange?: (sort: 'adp' | 'rank') => void;
}

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'DST';
type SortField = 'adp' | 'rank';

export function DraftPlayerList({
  availablePlayers,
  isUserTurn,
  onDraft,
  onAddToQueue,
  onRemoveFromQueue,
  isInQueue,
  onSortChange,
}: DraftPlayerListProps) {
  const [filter, setFilter] = useState<PositionFilter>('ALL');
  const [sortField, setSortFieldRaw] = useState<SortField>('adp');
  const setSortField = (field: SortField) => {
    setSortFieldRaw(field);
    onSortChange?.(field);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const filteredPlayers = useMemo(() => {
    let players = [...availablePlayers];

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      players = players.filter(p =>
        p.playerId.toUpperCase().includes(q) ||
        p.team.toUpperCase().includes(q)
      );
    }

    // Apply position filter
    if (filter !== 'ALL') {
      players = players.filter(p => positionFromPlayerId(p.playerId) === filter);
    }

    // Apply sort
    players.sort((a, b) => {
      if (sortField === 'adp') {
        const aVal = a.adp || a.rank || 999;
        const bVal = b.adp || b.rank || 999;
        return aVal - bVal;
      }
      return (a.rank || 999) - (b.rank || 999);
    });

    return players;
  }, [availablePlayers, filter, sortField, searchQuery]);

  const POSITION_FILTERS: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DST'];

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#000' }}>
      <style>{`
        .yellow-image-filter,
        .banana-queue-button:hover img {
          filter: brightness(50%) sepia(1) hue-rotate(21deg) saturate(2000%) brightness(100%);
        }
      `}</style>
      {/* Search/Filter Bar - centered at 920px */}
      <div className="w-full flex justify-center">
        <div className="w-full px-2 sm:px-0" style={{ maxWidth: 920 }}>
          {/* Buttons row */}
          <div
            style={{
              display: 'flex',
              padding: '10px 0px',
              textAlign: 'center',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 10,
              maxWidth: 920,
              margin: '20px auto 0px auto',
            }}
          >
            {showSearch ? (
              /* Expanded search input replaces buttons */
              <>
                <button
                  onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    background: '#000',
                    border: '1px solid #555',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 32,
                    borderRadius: 5,
                    fontSize: 9,
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  CLOSE
                </button>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Example: PHI-QB"
                  className="font-primary font-bold placeholder-white/40 focus:outline-none"
                  style={{
                    flex: 1,
                    background: '#424242',
                    borderRadius: 5,
                    fontSize: 18,
                    color: '#fff',
                    padding: '0px 3px',
                    height: 32,
                    border: 'none',
                    outline: 'none',
                  }}
                  autoFocus
                />
              </>
            ) : (
              /* Normal buttons row */
              <>
                {/* SEARCH button */}
                <button
                  onClick={() => setShowSearch(true)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    background: '#000',
                    border: '1px solid #555',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 32,
                    borderRadius: 5,
                    fontSize: 9,
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  SEARCH
                </button>

                {/* Position filter buttons */}
                {POSITION_FILTERS.map(pos => {
                  const posColor = pos !== 'ALL' ? (POSITION_COLORS[pos] || '#888') : '#555';
                  const isActive = filter === pos;

                  if (pos === 'ALL') {
                    return (
                      <button
                        key={pos}
                        onClick={() => setFilter(pos)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          height: 32,
                          borderRadius: 5,
                          background: '#555',
                          fontSize: 12,
                          fontWeight: 'bold',
                          color: '#fff',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        ALL
                      </button>
                    );
                  }

                  return (
                    <button
                      key={pos}
                      onClick={() => setFilter(pos)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: 32,
                        borderRadius: 5,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: posColor,
                        backgroundColor: isActive ? posColor : '#000',
                        fontSize: 12,
                        fontWeight: 'bold',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {pos}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* ADP/RANK sort toggles - separate row, right-aligned */}
          <div
            style={{
              maxWidth: 900,
              width: '100%',
              margin: '0 auto',
              paddingBottom: 4,
              paddingTop: 16,
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingRight: 15,
              gap: 15,
            }}
          >
            <button
              onClick={() => setSortField('adp')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                fontWeight: 'bold',
                color: sortField === 'adp' ? '#fde047' : '#6b7280',
                cursor: 'pointer',
                width: 40,
                textAlign: 'center',
                padding: 0,
              }}
            >
              ADP
            </button>
            <button
              onClick={() => setSortField('rank')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                fontWeight: 'bold',
                color: sortField === 'rank' ? '#fde047' : '#6b7280',
                cursor: 'pointer',
                width: 40,
                textAlign: 'center',
                padding: 0,
              }}
            >
              RANK
            </button>
          </div>
        </div>
      </div>

      {/* Player List */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center">
        {filteredPlayers.map(player => {
          const queued = isInQueue(player.playerId);
          const expanded = expandedPlayer === player.playerId;
          const hexColor = getPositionColorHex(player.position);

          return (
            <div key={player.playerId} style={{ maxWidth: 900, width: '100%', margin: '2px auto' }}>
              <button
                onClick={() => setExpandedPlayer(expanded ? null : player.playerId)}
                className="w-full text-left flex items-center transition-all"
                style={{
                  backgroundColor: '#000',
                  borderLeft: `2px solid ${hexColor}`,
                  borderRight: `2px solid ${hexColor}`,
                  borderTop: '1px solid #222',
                  borderBottom: '1px solid #222',
                  padding: '5px 8px',
                  gap: 12,
                  justifyContent: 'space-between',
                }}
              >
                {/* Queue banana icon */}
                <div style={{ width: 24, height: 24, flexShrink: 0 }}>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (queued) onRemoveFromQueue(player.playerId);
                      else onAddToQueue(player);
                    }}
                    className="banana-queue-button"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    title={queued ? 'Remove from queue' : 'Add to queue'}
                  >
                    <img
                      src={queued ? '/banana-filled.webp' : '/banana.webp'}
                      alt="banana"
                      className={queued ? 'yellow-image-filter' : ''}
                      style={{ position: 'relative', left: 12 }}
                    />
                  </button>
                </div>

                {/* Player ID with full position color background */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex flex-col">
                    <span
                      className="font-primary font-bold text-black px-1 rounded"
                      style={{
                        fontSize: 14,
                        backgroundColor: hexColor,
                      }}
                    >
                      {player.playerId}
                    </span>
                    <span
                      className="font-primary font-bold"
                      style={{ fontSize: 12, color: '#fff', marginTop: 2 }}
                    >
                      BYE {player.byeWeek}
                    </span>
                  </div>
                </div>

                {/* ADP & RANK */}
                <div style={{ display: 'flex', flexDirection: 'row', paddingRight: 15, gap: 15 }}>
                  <div style={{ width: 40, textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, color: '#fff' }}>
                      {player.adp || player.rank || 'N/A'}
                    </div>
                  </div>
                  <div style={{ width: 40, textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, color: '#fff' }}>
                      {player.rank || 'N/A'}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded details */}
              {expanded && (
                <div
                  className="flex flex-col items-center"
                  style={{
                    backgroundColor: '#000',
                    borderLeft: `2px solid ${hexColor}`,
                    borderRight: `2px solid ${hexColor}`,
                    borderBottom: '1px solid #222',
                  }}
                >
                  {/* Players from team */}
                  <div className="text-center">
                    <div style={{ color: '#888', fontSize: 12, textTransform: 'uppercase', margin: '10px 0px 3px 0px', fontWeight: 'bold' }}>
                      Players from team
                    </div>
                    <div className="text-center" style={{ fontSize: 14 }}>
                      {player.playersFromTeam.slice(0, 3).map((name, i) => (
                        <span key={i} className="pr-2 text-white">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex mx-auto text-center items-center justify-center gap-4 py-5">
                    <button
                      onClick={() => {
                        if (isUserTurn) {
                          onDraft(player.playerId);
                          setExpandedPlayer(null);
                        }
                      }}
                      disabled={!isUserTurn}
                      className={`uppercase font-primary font-bold py-1 px-2 rounded ${
                        isUserTurn
                          ? 'bg-[#F3E216] text-black cursor-pointer'
                          : 'bg-gray-500 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      Draft
                    </button>
                    <button
                      onClick={() => {
                        if (queued) onRemoveFromQueue(player.playerId);
                        else onAddToQueue(player);
                      }}
                      className="bg-[#F3E216] text-black font-primary font-bold uppercase py-1 px-2 rounded cursor-pointer"
                    >
                      {queued ? 'Unqueue' : 'Queue'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredPlayers.length === 0 && (
          <div className="flex items-center justify-center h-40 text-white/30 text-sm">
            No players match your filters
          </div>
        )}
      </div>
    </div>
  );
}
