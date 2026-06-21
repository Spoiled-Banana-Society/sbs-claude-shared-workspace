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
import { getPositionColorHex } from '@/lib/draftRoomConstants';

const HELP_COPY =
  'Caps how many of each position the auto-drafter can pick when you go AFK or use airplane mode. Only works while you have the draft open. Manual picks are never restricted. Defaults: QB:3 RB1:4 RB2:1 WR1:4 WR2:1 TE:3 DST:3.';

/** True if a draft room is open right now (cross-tab heartbeat, fresh < 10s).
 *  Used to warn that toggling caps won't change a draft you're already in. */
function isInActiveDraft(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('draft-room-ws:')) {
        const ts = Number(localStorage.getItem(k));
        if (ts && Date.now() - ts < 10_000) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

export function PositionLimitsPanel() {
  const { limits, enabled, loaded, saving, setLimit, setEnabled, resetToDefaults } = usePositionLimits();
  const [open, setOpen] = useState(true);
  const [draftWarn, setDraftWarn] = useState(false);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    // Turning OFF while a draft is open: that draft keeps the setting it
    // started with, so warn it only affects new drafts.
    setDraftWarn(!next && isInActiveDraft());
  };

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
            {loaded ? POSITIONS.map(p => `${p} ${limits[p]}`).join(' · ') : 'loading…'}
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

          {/* Master on/off */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Enforce these limits</p>
              <p className="text-[11px] text-text-muted">Off = auto-draft ignores all caps and takes best available.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={handleToggle}
              disabled={!loaded}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-banana' : 'bg-bg-elevated'}`}
              aria-label="Toggle auto-draft position limits"
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {draftWarn && (
            <p className="text-[11px] text-yellow-400 leading-relaxed">
              Heads up — you&apos;re in a draft right now. This change won&apos;t affect that draft; it keeps the setting it started with. It applies to new drafts you enter.
            </p>
          )}

          <div className={`grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
            {POSITIONS.map(pos => (
              <div
                key={pos}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-bg-tertiary px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: getPositionColorHex(pos) }}
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
