'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Admin moderation menu for a single chat message. Discord-parity options:
 *  - Delete this message
 *  - Mute user (timeout) → submenu: 60s / 5m / 10m / 1h / 1d / 1w
 *  - Delete recent messages from user → submenu: 1h / 6h / 12h / 24h / 3d / 7d / all
 *  - Unmute (only shown if useful — admin can also re-issue mute with 0 duration)
 *
 * Matches Discord's "Timeout" + "Ban / Delete Messages" dropdowns. The mute
 * and delete-recent flows are separate endpoint calls (POST /moderate with
 * different `action`) so each is atomic on the server side.
 */

interface ChatMessageLike {
  id: string;
  walletAddress: string;
  username: string;
}

interface Props {
  message: ChatMessageLike;
  onClose: () => void;
  onDeleteMessage: () => void;
  onModerate: (body: Record<string, unknown>) => void;
}

const MUTE_DURATIONS = [
  { label: '60 seconds', ms: 60 * 1000 },
  { label: '5 minutes', ms: 5 * 60 * 1000 },
  { label: '10 minutes', ms: 10 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
];

const DELETE_LOOKBACKS = [
  { label: 'Previous hour', ms: 60 * 60 * 1000 },
  { label: 'Previous 6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: 'Previous 12 hours', ms: 12 * 60 * 60 * 1000 },
  { label: 'Previous 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Previous 3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'Previous 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'All messages from user', ms: 0 },
];

type View = 'root' | 'mute' | 'delete';

export function ChatModerationMenu({ message, onClose, onDeleteMessage, onModerate }: Props) {
  const [view, setView] = useState<View>('root');
  const ref = useRef<HTMLDivElement>(null);

  // Click outside / Escape closes.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-60 bg-[#1c1c1e] border border-white/[0.08] rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {view === 'root' && (
        <div className="py-1">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <p className="text-white/40 text-[10px] uppercase tracking-wider">Moderate</p>
            <p className="text-white/80 text-sm font-medium truncate">{message.username}</p>
          </div>
          <button
            onClick={onDeleteMessage}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Delete this message
          </button>
          <button
            onClick={() => setView('mute')}
            className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/[0.05] transition-colors flex items-center justify-between"
          >
            <span>Mute user (timeout)</span>
            <span className="text-white/30">›</span>
          </button>
          <button
            onClick={() => setView('delete')}
            className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/[0.05] transition-colors flex items-center justify-between"
          >
            <span>Delete recent messages</span>
            <span className="text-white/30">›</span>
          </button>
          <button
            onClick={() => onModerate({ action: 'unmute', targetWallet: message.walletAddress })}
            className="w-full px-3 py-2 text-left text-sm text-white/60 hover:bg-white/[0.05] transition-colors"
          >
            Unmute
          </button>
        </div>
      )}

      {view === 'mute' && (
        <div className="py-1">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
            <button onClick={() => setView('root')} className="text-white/40 hover:text-white">‹</button>
            <p className="text-white/80 text-sm font-medium">Mute duration</p>
          </div>
          {MUTE_DURATIONS.map((d) => (
            <button
              key={d.ms}
              onClick={() => onModerate({ action: 'mute', targetWallet: message.walletAddress, durationMs: d.ms })}
              className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/[0.05] transition-colors"
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {view === 'delete' && (
        <div className="py-1 max-h-[60vh] overflow-y-auto">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 sticky top-0 bg-[#1c1c1e]">
            <button onClick={() => setView('root')} className="text-white/40 hover:text-white">‹</button>
            <p className="text-white/80 text-sm font-medium">Delete messages from</p>
          </div>
          {DELETE_LOOKBACKS.map((d) => (
            <button
              key={d.label}
              onClick={() => onModerate({ action: 'delete_recent', targetWallet: message.walletAddress, lookbackMs: d.ms })}
              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                d.ms === 0
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-white/80 hover:bg-white/[0.05]'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
