'use client';

import React from 'react';
import { DraftRoom } from '@/types';

interface DraftRoomCardProps {
  room: DraftRoom;
  onEnter: (room: DraftRoom) => void;
  timer?: number;
}

export function DraftRoomCard({ room, onEnter, timer }: DraftRoomCardProps) {
  const isLive = room.status === 'drafting' || room.status === 'ready';
  const isYourPick = room.isOnClock;

  return (
    <div
      onClick={() => onEnter(room)}
      className={`
        relative cursor-pointer rounded-2xl p-5 transition-all duration-200
        ${isYourPick
          ? 'bg-red-500/10 border border-red-500/30'
          : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]'
        }
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold">{room.contestName}</h3>
          {room.type !== 'regular' && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              room.type === 'jackhof' ? 'bg-gradient-to-r from-jackpot/20 to-hof/20 text-hof'
                : room.type === 'jackpot' ? 'bg-hof/20 text-hof' : 'bg-jackpot/20 text-jackpot'
            }`}>
              {room.type === 'jackhof' ? 'JACKHOF' : room.type === 'jackpot' ? 'JP' : 'HOF'}
            </span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          room.draftSpeed === 'fast'
            ? 'bg-green-500/15 text-green-400'
            : 'bg-orange-500/15 text-orange-400'
        }`}>
          {room.draftSpeed === 'fast' ? 'Fast' : 'Slow'}
        </span>
      </div>

      {/* Players */}
      <div className="flex items-center justify-between text-sm mb-3">
        <span className="text-white/40">Players</span>
        <span className="text-white">{room.players}/{room.maxPlayers}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-banana rounded-full transition-all"
          style={{ width: `${(room.players / room.maxPlayers) * 100}%` }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {isYourPick ? (
            <span className="text-red-400 font-medium">{timer ?? 0}s left</span>
          ) : isLive && room.picksAway ? (
            <span className="text-white/40">{room.picksAway} picks away</span>
          ) : (
            <span className={`${isLive ? 'text-success' : 'text-white/40'}`}>
              {isLive ? 'Live' : 'Filling'}
            </span>
          )}
        </div>
        <button
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
            isYourPick
              ? 'bg-red-500 text-white'
              : 'bg-banana text-black'
          }`}
        >
          {isYourPick ? 'Pick' : 'Enter'}
        </button>
      </div>
    </div>
  );
}
