'use client';

import React, { useState } from 'react';
import { usePositionLimits } from '@/hooks/usePositionLimits';
import {
  DEFAULT_POSITION_LIMITS,
  isUnderfilled,
  LIMIT_BOUNDS,
  POSITIONS,
  TOTAL_DRAFT_ROUNDS,
  totalCap,
  type Position,
} from '@/lib/positionLimits';
import { POSITION_COLORS } from '@/lib/draftRoomConstants';

const HELP_COPY =
  'Caps how many of each position the auto-drafter picks for you — but only while you keep the draft open on this device (airplane mode, or this tab auto-picking on your behalf). If you close the app or tab mid-draft, picks are made for you without these limits. Manual picks are never restricted. Defaults: QB:3 RB:7 WR:7 TE:3 DST:3.';

export function PositionLimitsPanel() {
  const { limits, loaded, saving, setLimit, resetToDefaults } = usePositionLimits();
  const [open, setOpen] = useState(true);

  const sum = totalCap(limits);
  const underfilled = isUnderfilled(limits);

  const adjust = (pos: Position, delta: number) => {
    const next = Math.max(LIMIT_BOUNDS.min, Math.min(LIMIT_BOUNDS.max, limits[pos] + delta));
    if (next !== limits[pos]) setLimit(pos, next);
  };

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-bg-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-text-primary font-semibold">Auto-draft position limits</span>
          <span className="text-xs text-text-muted">
            {loaded ? `QB ${limits.QB} · RB ${limits.RB} · WR ${limits.WR} · TE ${limits.TE} · DST ${limits.DST}` : 'loading…'}
          </span>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          <p className="text-xs text-text-muted leading-relaxed">{HELP_COPY}</p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {POSITIONS.map(pos => (
              <div
                key={pos}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-bg-tertiary px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: POSITION_COLORS[pos] }}
                    aria-hidden
                  />
                  <span className="text-sm font-bold text-text-primary">{pos}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjust(pos, -1)}
                    disabled={!loaded || limits[pos] <= LIMIT_BOUNDS.min}
                    className="w-6 h-6 rounded bg-bg-elevated text-text-secondary hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
                    aria-label={`Decrease ${pos} limit`}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-mono text-text-primary tabular-nums">
                    {limits[pos]}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjust(pos, +1)}
                    disabled={!loaded || limits[pos] >= LIMIT_BOUNDS.max}
                    className="w-6 h-6 rounded bg-bg-elevated text-text-secondary hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
                    aria-label={`Increase ${pos} limit`}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-text-muted">
              <span className={underfilled ? 'text-yellow-400' : ''}>
                Sum: <span className="font-mono">{sum}</span>
              </span>
              <span className="mx-2 text-white/20">·</span>
              <span>Draft length: {TOTAL_DRAFT_ROUNDS} rounds</span>
              {underfilled && (
                <span className="ml-2 text-yellow-400">
                  Caps below roster size — picker relaxes when stuck.
                </span>
              )}
              {saving && <span className="ml-2 text-text-muted italic">saving…</span>}
            </div>
            <button
              type="button"
              onClick={resetToDefaults}
              disabled={!loaded ||
                POSITIONS.every(p => limits[p] === DEFAULT_POSITION_LIMITS[p])}
              className="text-xs uppercase tracking-wider text-text-muted hover:text-banana disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
