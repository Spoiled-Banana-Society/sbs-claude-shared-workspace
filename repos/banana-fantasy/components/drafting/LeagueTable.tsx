'use client';

import React, { useState, useEffect } from 'react';
import { useSlowClock } from '@/contexts/SlowClockContext';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { DraftRoom } from '@/types';

interface LeagueTableProps {
  rooms: DraftRoom[];
  onEnter: (room: DraftRoom) => void;
  onBuyDrafts?: () => void;
}

export function LeagueTable({ rooms, onEnter, onBuyDrafts }: LeagueTableProps) {
  const { copy: slowClock } = useSlowClock();
  const [timers, setTimers] = useState<{ [roomId: string]: number }>({});

  useEffect(() => {
    const initialTimers: { [roomId: string]: number } = {};
    rooms.forEach(room => {
      if (room.status === 'drafting' && room.isOnClock && room.timeRemaining !== undefined) {
        initialTimers[room.id] = room.timeRemaining;
      }
    });
    setTimers(initialTimers);
  }, [rooms]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(roomId => {
          if (updated[roomId] > 0) {
            updated[roomId] = updated[roomId] - 1;
          }
        });
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredRooms = rooms
    .sort((a, b) => {
      // First: on the clock (your turn)
      if (a.isOnClock && !b.isOnClock) return -1;
      if (!a.isOnClock && b.isOnClock) return 1;

      // Then: by picks away (lower = closer to top)
      const aPicksAway = a.picksAway ?? 999;
      const bPicksAway = b.picksAway ?? 999;
      if (aPicksAway !== bPicksAway) return aPicksAway - bPicksAway;

      return 0;
    });

  const draftsCount = rooms.length;
  const onClockCount = rooms.filter(r => r.isOnClock).length;

  return (
    <div>
      {/* Stats Bar */}
      <div className="flex items-center gap-5 mb-4">
        {onBuyDrafts && (
          <Button size="sm" onClick={onBuyDrafts} className="!font-bold">
            Buy Drafts
          </Button>
        )}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-white rounded-full" />
          <span className="text-white text-sm font-medium">{draftsCount} Drafts</span>
        </div>
        {onClockCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-green-400 text-sm font-medium">{onClockCount} Picking</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
        {/* Table Header */}
        <div className="grid grid-cols-6 gap-6 px-6 py-3 border-b border-white/[0.06]">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider">
            Draft
          </div>
          <Tooltip content="Spin to reveal: Pro · HOF (5%) · Jackpot (1%) · JackHOF (1/800)">
            <div className="text-xs font-medium text-white/40 uppercase tracking-wider text-center cursor-help">
              Type
            </div>
          </Tooltip>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider text-center">
            Players
          </div>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider text-center">
            Clock
          </div>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider text-center">
            Status
          </div>
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider text-center">
            Action
          </div>
        </div>

        {/* Table Rows */}
        <div>
          {filteredRooms.map((room, index) => (
            <div
              key={room.id}
              className={`
                grid grid-cols-6 gap-6 px-6 py-5 items-center transition-all duration-200 cursor-pointer
                ${room.status !== 'filling'
                  ? (room.type === 'jackpot' || room.type === 'jackhof')
                    ? room.isOnClock
                      ? 'bg-gradient-to-r from-red-500/[0.15] to-transparent'
                      : 'bg-gradient-to-r from-red-500/[0.06] to-transparent hover:from-red-500/[0.10]'
                    : room.type === 'hof'
                    ? room.isOnClock
                      ? 'bg-gradient-to-r from-[#FFD700]/[0.15] to-transparent'
                      : 'bg-gradient-to-r from-[#FFD700]/[0.06] to-transparent hover:from-[#FFD700]/[0.10]'
                    : room.isOnClock
                    ? 'bg-gradient-to-r from-green-600/[0.12] to-transparent'
                    : ''
                  : 'hover:bg-white/[0.02]'
                }
                ${index !== filteredRooms.length - 1 ? 'border-b border-white/[0.04]' : ''}
              `}
              onClick={() => onEnter(room)}
            >
              {/* Draft Name + Speed Badge */}
              <div className="flex items-center gap-3">
                <span className="text-white font-medium">{room.contestName}</span>
                <Tooltip content={room.draftSpeed === 'fast' ? '30 seconds per pick' : slowClock.perPick}>
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    {room.draftSpeed === 'fast' ? '30s' : slowClock.short}
                  </span>
                </Tooltip>
              </div>

              {/* Type */}
              <div className="flex justify-center">
                {room.status === 'filling' ? (
                  <span className="text-sm text-white/40">Unrevealed</span>
                ) : room.type === 'jackpot' ? (
                  <span className="text-sm font-semibold text-red-400">Jackpot</span>
                ) : room.type === 'hof' ? (
                  <span className="text-sm font-semibold text-[#D4AF37]">HOF</span>
                ) : room.type === 'jackhof' ? (
                  <span className="text-sm font-semibold"><span className="text-red-400">Jack</span><span className="text-[#D4AF37]">HOF</span></span>
                ) : (
                  <span className="text-sm text-white/70">Pro</span>
                )}
              </div>

              {/* Players with progress */}
              {room.status === 'filling' ? (
                <Tooltip content={`Waiting for ${room.maxPlayers - room.players} more players to join for draft to start`}>
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-white text-sm">
                      {room.players}<span className="text-white/30">/{room.maxPlayers}</span>
                    </span>
                    <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all bg-white/30"
                        style={{ width: `${(room.players / room.maxPlayers) * 100}%` }}
                      />
                    </div>
                  </div>
                </Tooltip>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-white text-sm">
                    {room.players}<span className="text-white/30">/{room.maxPlayers}</span>
                  </span>
                  <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-white/30"
                      style={{ width: `${(room.players / room.maxPlayers) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Clock */}
              <div className="flex justify-center">
                {room.status === 'drafting' || room.status === 'ready' ? (
                  room.isOnClock ? (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                      room.type === 'jackpot'
                        ? 'bg-red-500/20 border border-red-500/30'
                        : room.type === 'hof'
                        ? 'bg-[#FFD700]/20 border border-[#FFD700]/30'
                        : 'bg-green-600/20 border border-green-600/30'
                    }`}>
                      <span className={`text-sm font-bold tabular-nums ${
                        room.type === 'jackpot'
                          ? 'text-red-400'
                          : room.type === 'hof'
                          ? 'text-[#FFD700]'
                          : 'text-green-400'
                      }`}>
                        {timers[room.id] ?? 0}s
                      </span>
                    </div>
                  ) : room.picksAway ? (
                    <span className="text-white/80 text-sm">{room.picksAway} picks away</span>
                  ) : (
                    <span className="text-white/20 text-sm">—</span>
                  )
                ) : (
                  <span className="text-white/20 text-sm">—</span>
                )}
              </div>

              {/* Status */}
              <div className="flex justify-center">
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                  room.status === 'filling' ? 'text-gray-400' : 'text-white'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    room.status === 'filling'
                      ? 'bg-gray-400'
                      : room.isOnClock
                      ? 'bg-green-400 animate-pulse'
                      : 'bg-white animate-pulse'
                  }`} />
                  <span className="w-[70px] whitespace-nowrap">
                    {room.status === 'filling' ? 'Filling' : room.isOnClock ? 'Your Pick' : 'Drafting'}
                  </span>
                </span>
              </div>

              {/* Action */}
              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                {room.status === 'filling' ? (
                  <Button
                    size="sm"
                    onClick={() => onEnter(room)}
                    className="w-20 !font-bold transition-all duration-200 hover:scale-110"
                  >
                    {room.players === room.maxPlayers ? 'Enter' : 'Join'}
                  </Button>
                ) : room.isOnClock ? (
                  <Button
                    size="sm"
                    onClick={() => onEnter(room)}
                    className={`w-20 transition-all duration-200 hover:scale-110 ${
                      room.type === 'jackpot'
                        ? '!bg-red-500 hover:!bg-red-600 !from-red-500 !to-red-500 !text-white !shadow-red-500/25'
                        : room.type === 'hof'
                        ? '!bg-[#D4AF37] hover:!bg-[#B8972E] !from-[#D4AF37] !to-[#D4AF37] !text-black !shadow-[#D4AF37]/25'
                        : '!bg-green-600 hover:!bg-green-700 !from-green-600 !to-green-600 !text-white !shadow-green-600/25'
                    }`}
                  >
                    Pick
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => onEnter(room)}
                    className={`w-20 !bg-white !from-white !to-white !text-black !shadow-white/25 transition-all duration-200 hover:scale-110 ${
                      room.type === 'jackpot'
                        ? 'hover:!bg-red-500 hover:!from-red-500 hover:!to-red-500 hover:!text-white'
                        : room.type === 'hof'
                        ? 'hover:!bg-[#D4AF37] hover:!from-[#D4AF37] hover:!to-[#D4AF37] hover:!text-black'
                        : 'hover:!bg-[#fbbf24] hover:!from-[#fbbf24] hover:!to-[#fbbf24] hover:!text-black'
                    }`}
                  >
                    Enter
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredRooms.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-white/40">No drafts available</p>
          </div>
        )}
      </div>
    </div>
  );
}
