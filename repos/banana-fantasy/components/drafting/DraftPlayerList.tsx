'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { getPositionColorHex, positionFromPlayerId, POSITION_COLORS } from '@/lib/draftRoomConstants';
import type { PlayerData } from '@/lib/draftRoomConstants';
import { SLOT_STATS_HISTORY } from '@/data/slot-stats-history';

interface DraftPlayerListProps {
  availablePlayers: PlayerData[];
  isUserTurn: boolean;
  onDraft: (playerId: string) => void;
  onAddToQueue: (player: PlayerData) => void;
  onRemoveFromQueue: (playerId: string) => void;
  isInQueue: (playerId: string) => boolean;
  onSortChange?: (sort: 'adp' | 'rank') => void;
  sortPreference?: 'adp' | 'rank';
  /** Override rank values for sort + display when the live per-draft
   *  ranking data isn't available yet (e.g. draft hasn't started). */
  userRankMap?: Map<string, number>;
  /** Override stats (adp, byeWeek) for sort + display, same fallback. */
  userStatsMap?: Map<string, { rank?: number; adp?: number; byeWeek?: number }>;
  /** The user's next two overall pick numbers — renders the small
   *  "YOUR PICK · N" divider where each lands in the ADP order. Only shown
   *  in the unfiltered ADP view, where its position is honest. */
  upcomingUserPicks?: number[];
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
  sortPreference,
  userRankMap,
  userStatsMap,
  upcomingUserPicks,
}: DraftPlayerListProps) {
  const resolveRank = (player: PlayerData): number => {
    const custom = userRankMap?.get(player.playerId);
    if (typeof custom === 'number' && custom > 0) return custom;
    return player.rank || 999;
  };
  const resolveAdp = (player: PlayerData): number => {
    const custom = userStatsMap?.get(player.playerId)?.adp;
    if (typeof custom === 'number' && custom > 0) return custom;
    return player.adp || 0;
  };
  const resolveBye = (player: PlayerData): number | string => {
    const custom = userStatsMap?.get(player.playerId)?.byeWeek;
    if (typeof custom === 'number' && custom > 0) return custom;
    return player.byeWeek;
  };
  // Multi-select position filter: empty set = show all (the "ALL" chip).
  // Toggling a position adds/removes it; ALL clears the set.
  type Pos = Exclude<PositionFilter, 'ALL'>;
  const [activePositions, setActivePositions] = useState<Set<Pos>>(new Set());
  const togglePosition = (pos: Pos) =>
    setActivePositions(prev => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  const [sortField, setSortFieldRaw] = useState<SortField>(sortPreference ?? 'adp');
  useEffect(() => {
    if (sortPreference && sortPreference !== sortField) {
      setSortFieldRaw(sortPreference);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortPreference]);
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

    // Apply position filter (multi-select — keep players in ANY selected position)
    if (activePositions.size > 0) {
      players = players.filter(p => activePositions.has(positionFromPlayerId(p.playerId) as Pos));
    }

    // Apply sort
    players.sort((a, b) => {
      if (sortField === 'adp') {
        const aVal = resolveAdp(a) || resolveRank(a);
        const bVal = resolveAdp(b) || resolveRank(b);
        return aVal - bVal;
      }
      return resolveRank(a) - resolveRank(b);
    });

    return players;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePlayers, activePositions, sortField, searchQuery, userRankMap, userStatsMap]);

  // "YOUR PICK · N" dividers. ADP shares the 1–150 overall-pick scale, so a
  // divider sits before the first player whose sort value is past that pick —
  // players above it will likely be gone by then. Only rendered in the full
  // ADP-sorted view; any search/filter/RANK sort makes the position a lie.
  // Back-to-back picks at the snake turn merge into one line.
  const pickMarkersByIndex = useMemo(() => {
    const markers = new Map<number, { label: string; faint: boolean }[]>();
    if (!upcomingUserPicks || upcomingUserPicks.length === 0) return markers;
    if (sortField !== 'adp' || searchQuery.trim() || activePositions.size > 0) return markers;

    // Same fallback chain as the sort comparator, so the divider can never
    // land out of order with the rows around it.
    const sortValue = (p: PlayerData) => resolveAdp(p) || resolveRank(p);
    const indexFor = (pick: number) => filteredPlayers.findIndex(p => sortValue(p) >= pick);

    const [first, second] = upcomingUserPicks;
    const firstIdx = indexFor(first);
    if (second === first + 1) {
      if (firstIdx >= 0) {
        markers.set(firstIdx, [{ label: `Your picks · ${first} & ${second}`, faint: false }]);
      }
      return markers;
    }
    if (firstIdx >= 0) {
      markers.set(firstIdx, [{ label: `Your pick · ${first}`, faint: false }]);
    }
    if (typeof second === 'number') {
      const secondIdx = indexFor(second);
      if (secondIdx >= 0) {
        markers.set(secondIdx, [
          ...(markers.get(secondIdx) ?? []),
          { label: `Pick ${second}`, faint: true },
        ]);
      }
    }
    return markers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPlayers, upcomingUserPicks, sortField, searchQuery, activePositions]);

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
                  const isActive = pos !== 'ALL' && activePositions.has(pos as Pos);

                  if (pos === 'ALL') {
                    return (
                      <button
                        key={pos}
                        onClick={() => setActivePositions(new Set())}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          height: 32,
                          borderRadius: 5,
                          background: activePositions.size === 0 ? '#555' : '#1a1a1a',
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
                      onClick={() => togglePosition(pos as Pos)}
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
        {filteredPlayers.map((player, playerIdx) => {
          const queued = isInQueue(player.playerId);
          const expanded = expandedPlayer === player.playerId;
          const hexColor = getPositionColorHex(player.position);

          return (
            <React.Fragment key={player.playerId}>
              {pickMarkersByIndex.get(playerIdx)?.map(marker => (
                <div
                  key={marker.label}
                  style={{ maxWidth: 900, width: '100%', margin: '0 auto', padding: '5px 8px', textAlign: 'center' }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      color: marker.faint ? 'rgba(253,224,71,0.45)' : '#fde047',
                    }}
                  >
                    {marker.label}
                  </span>
                </div>
              ))}
              <div style={{ maxWidth: 900, width: '100%', margin: '2px auto' }}>
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
                      BYE {resolveBye(player)}
                    </span>
                  </div>
                </div>

                {/* ADP & RANK */}
                <div style={{ display: 'flex', flexDirection: 'row', paddingRight: 15, gap: 15 }}>
                  <div style={{ width: 40, textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, color: '#fff' }}>
                      {resolveAdp(player) || resolveRank(player) || 'N/A'}
                    </div>
                  </div>
                  <div style={{ width: 40, textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, color: '#fff' }}>
                      {resolveRank(player) || 'N/A'}
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

                  {/* Slot history — what this team-position slot actually
                      scored the past 3 seasons (weeks 1-17, SBS scoring) */}
                  {SLOT_STATS_HISTORY[player.playerId] && (
                    <div style={{ width: 280, maxWidth: '90%', paddingBottom: 14 }}>
                      <div style={{ display: 'flex', paddingBottom: 4 }}>
                        <div style={{ flex: 1 }} />
                        <div style={{ width: 100, textAlign: 'right', color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 }}>
                          AVG / WK
                        </div>
                        <div style={{ width: 80, textAlign: 'right', color: '#555', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 }}>
                          TOTAL
                        </div>
                      </div>
                      {['2025', '2024', '2023'].map(season => {
                        const s = SLOT_STATS_HISTORY[player.playerId][season];
                        if (!s) return null;
                        return (
                          <div key={season} style={{ display: 'flex', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid #16161c' }}>
                            <div style={{ flex: 1, textAlign: 'left', fontWeight: 'bold', fontSize: 14, color: '#9ca3af' }}>
                              {season}
                            </div>
                            <div style={{ width: 100, textAlign: 'right', color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
                              {s.avg}
                            </div>
                            <div style={{ width: 80, textAlign: 'right', color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
                              {s.total}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              </div>
            </React.Fragment>
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
