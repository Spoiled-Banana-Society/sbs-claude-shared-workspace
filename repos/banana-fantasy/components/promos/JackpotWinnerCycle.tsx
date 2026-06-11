'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Compact winner-picker animation for the Jackpot Hit promo modal.
// Renders 10 numbered tiles, cycles a yellow highlight through them
// with quadratic ease-out, and lands on the deterministic winner
// (sha256(seed) mod 10 — same algo as the server-side gate in
// recordJackpotHit so the modal visual + the actual credit agree).
//
// `seed` is the draftId of the JP draft. If callers pass a synthetic
// seed (no real JP yet), the animation still plays — the cycling is
// purely visual.
//
// `winnerLabel` defaults to "Drafter #N" but callers can pass real
// usernames in `labels` to show actual handles.

export interface JackpotDrawEntry {
  /** Live-resolved display name (default Banana##### or edited). */
  name: string;
  /** The entrant's REAL slot number in the draft (1-based), not a renumbering. */
  slot: number;
  /** Live pfp URL; defaults to the plain banana. */
  pfp?: string | null;
}

export interface JackpotWinnerCycleProps {
  seed: string;
  labels?: string[];
  /** Rich entries (real slot # + live name + pfp). Preferred over labels. */
  entries?: JackpotDrawEntry[];
  winnerLabel?: string;
  autoPlay?: boolean;
  /** Recorded winner index from the server draw. Required for VRF draws —
   *  the sealed seed can't be recomputed client-side until period reveal. */
  winnerIdxOverride?: number | null;
  onSettled?: (winnerIdx: number) => void;
}

export function JackpotWinnerCycle({
  seed,
  labels,
  entries,
  autoPlay = true,
  winnerIdxOverride,
  onSettled,
}: JackpotWinnerCycleProps) {
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const effectiveLabels = entries && entries.length > 0 ? entries.map((e) => e.name) : labels;
  const labelsRef = useRef(effectiveLabels);
  labelsRef.current = effectiveLabels;
  const winnerIdxRef = useRef(winnerIdxOverride);
  winnerIdxRef.current = winnerIdxOverride;
  const run = useCallback(async (id: string) => {
    cancelRef.current?.();
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    cancelRef.current = () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };

    setRunning(true);
    setSettled(false);
    setHighlightIdx(null);

    const count = labelsRef.current && labelsRef.current.length > 0 ? labelsRef.current.length : 10;
    let winnerIdx = 0;
    const override = winnerIdxRef.current;
    if (typeof override === 'number' && override >= 0 && override < count) {
      // Server-recorded winner (VRF draws — sealed seed isn't recomputable
      // client-side until the period reveals).
      winnerIdx = override;
    } else {
      try {
        const enc = new TextEncoder();
        const digest = await crypto.subtle.digest('SHA-256', enc.encode(id));
        const view = new DataView(digest);
        winnerIdx = view.getUint32(0, false) % count;
      } catch {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
        winnerIdx = Math.abs(h) % count;
      }
    }
    if (cancelled) return;

    const totalTicks = 28;
    let curr = ((winnerIdx - (totalTicks - 1)) % count + count) % count;

    const tick = (n: number) => {
      if (cancelled) return;
      if (n >= totalTicks) {
        setHighlightIdx(winnerIdx);
        setSettled(true);
        setRunning(false);
        onSettledRef.current?.(winnerIdx);
        return;
      }
      setHighlightIdx(curr);
      curr = (curr + 1) % count;
      const t = n / totalTicks;
      const interval = 70 + Math.pow(t, 2) * 380;
      timeoutId = setTimeout(() => tick(n + 1), interval);
    };
    tick(0);
  }, []);

  useEffect(() => {
    if (autoPlay) run(seed);
    return () => cancelRef.current?.();
  }, [seed, autoPlay, run]);

  const replay = () => run(seed);

  return (
    <div className="bg-bg-tertiary rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-text-primary">Picking the winner…</h4>
        <button
          onClick={replay}
          disabled={running}
          className="text-[11px] uppercase tracking-wider text-text-muted hover:text-banana disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Replay
        </button>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: effectiveLabels && effectiveLabels.length > 0 ? effectiveLabels.length : 10 }, (_, i) => {
          const isCycling = highlightIdx === i && !settled;
          const isWinner = settled && highlightIdx === i;
          const entry = entries?.[i];
          const label = effectiveLabels?.[i] ?? `#${i + 1}`;
          const truncated = label.length > 10 ? `${label.slice(0, 8)}…` : label;
          // Real draft slot when known (entries) — never a renumbering.
          const slotNo = entry?.slot ?? i + 1;

          const bg = isWinner ? '#FF474C' : isCycling ? '#fbbf24' : '#1a1a1a';
          const border = isWinner ? '#fff' : isCycling ? '#fbbf24' : '#333';
          const text = isWinner || isCycling ? '#111' : '#fff';
          const shadow = isWinner
            ? '0 0 18px 3px rgba(255, 71, 76, 0.85), 0 0 40px 8px rgba(255, 71, 76, 0.4)'
            : isCycling
            ? '0 0 10px 1px rgba(251, 191, 36, 0.7)'
            : 'none';
          const transform = isWinner ? 'scale(1.06)' : isCycling ? 'scale(1.03)' : 'scale(1)';

          return (
            <div
              key={i}
              className={`relative rounded-lg flex flex-col items-center justify-center py-2 ${isWinner ? 'animate-pulse' : ''}`}
              style={{
                background: bg,
                borderWidth: isWinner ? 2 : 1,
                borderStyle: 'solid',
                borderColor: border,
                color: text,
                boxShadow: shadow,
                transform,
                transition: 'all 120ms ease-out',
                minHeight: entry ? 78 : 56,
                zIndex: isWinner ? 10 : isCycling ? 5 : 1,
              }}
            >
              {isWinner && (
                <div
                  className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full font-black text-[9px] tracking-wider whitespace-nowrap"
                  style={{
                    background: '#fff',
                    color: '#FF474C',
                    boxShadow: '0 0 10px rgba(255,255,255,0.6)',
                  }}
                >
                  WINNER
                </div>
              )}
              {entry ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.pfp || '/banana-profile.png'}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover mb-0.5"
                  style={{ border: `1px solid ${isWinner || isCycling ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)'}` }}
                />
              ) : null}
              <span className="text-[10px] font-bold opacity-70">#{slotNo}</span>
              <span className="text-[11px] font-semibold leading-tight">{truncated}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-text-muted text-center mt-3">
        Drawn from VRF randomness sealed on-chain before this draft existed.
      </p>
    </div>
  );
}
