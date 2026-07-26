'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

/**
 * Banana Draw reveal — a single-slot name reel that decelerates onto the winner.
 *
 * Why not reuse JackpotWinnerCycle: that one renders a TILE PER ENTRANT, which
 * works for a 10-seat jackpot draft and falls apart for a raffle that can hold
 * hundreds of Bananas across dozens of players. A one-slot reel reads the same
 * at any pool size and never reflows.
 *
 * The animation is PURELY COSMETIC. The winner is decided server-side from the
 * sealed VRF seed and passed in as `winnerName`; nothing here can change it,
 * and the reel is seeded to land on exactly that name. Same contract as the
 * jackpot draw's `winnerIdxOverride` — the client cannot recompute a sealed
 * seed, so it is TOLD the outcome and only performs it.
 */

export interface BananaDrawRevealProps {
  /** Display names of everyone who entered — the reel cycles through these. */
  entrants: string[];
  /** The server-decided winner. The reel always lands here. */
  winnerName: string;
  /** Winner's Banana count, shown on settle. */
  winnerBananas?: number;
  autoPlay?: boolean;
  onSettled?: () => void;
}

const SPIN_MS = 3200;
const MIN_TICK = 45;
const MAX_TICK = 340;

export function BananaDrawReveal({
  entrants,
  winnerName,
  winnerBananas,
  autoPlay = true,
  onSettled,
}: BananaDrawRevealProps) {
  const [current, setCurrent] = useState<string>(entrants[0] ?? winnerName);
  const [settled, setSettled] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  // Ref, not a dep — a callback in the dep array re-fires the effect on every
  // parent render (Rule #0, the render-loop self-DDoS).
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const run = useCallback(() => {
    cancelRef.current?.();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    cancelRef.current = () => { cancelled = true; if (timer) clearTimeout(timer); };

    // Cycle a shuffled pool so repeated draws don't feel identical, but always
    // land on the winner. A tiny pool still reads as motion because the winner
    // is appended rather than the list being replayed in order.
    const pool = entrants.length > 0 ? entrants : [winnerName];
    setRunning(true);
    setSettled(false);

    const start = Date.now();
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / SPIN_MS);
      // Quadratic ease-out: fast blur → slow, readable names at the end.
      const delay = MIN_TICK + (MAX_TICK - MIN_TICK) * (t * t);

      if (t >= 1) {
        setCurrent(winnerName);
        setSettled(true);
        setRunning(false);
        onSettledRef.current?.();
        return;
      }
      setCurrent(pool[i % pool.length]);
      i += 1;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => cancelRef.current?.();
  }, [entrants, winnerName]);

  useEffect(() => {
    if (!autoPlay) return;
    run();
    return () => cancelRef.current?.();
  }, [autoPlay, run]);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="text-text-muted text-xs uppercase tracking-[0.18em]">
        Tonight&apos;s <JackHofWordmark size={11} /> seat
      </div>

      <div
        className={`w-full max-w-xs rounded-xl border px-4 py-5 text-center transition-colors duration-300 ${
          settled ? 'border-transparent' : 'border-white/10 bg-bg-elevated'
        }`}
        style={settled ? {
          background: 'linear-gradient(90deg, rgba(239,68,68,.16), rgba(212,175,55,.16))',
          boxShadow: '0 0 0 1px rgba(239,68,68,.45) inset',
        } : undefined}
        aria-live="polite"
      >
        <div
          className={`font-bold tabular-nums truncate transition-all duration-150 ${
            settled ? 'text-xl text-text-primary' : 'text-lg text-text-secondary opacity-70'
          }`}
        >
          {current}
        </div>
        {settled && (
          <div className="text-text-muted text-xs mt-1.5">
            {winnerBananas != null ? <>won on 🍌 {winnerBananas}</> : 'takes the seat'}
          </div>
        )}
      </div>

      {!settled && running && (
        <p className="text-text-muted text-xs">Drawing from the sealed number…</p>
      )}
      {settled && (
        <p className="text-text-muted text-xs text-center max-w-xs">
          Drawn from a random number sealed before the clock ran out — published with
          the full entry list, so anyone can check it.
        </p>
      )}
    </div>
  );
}
