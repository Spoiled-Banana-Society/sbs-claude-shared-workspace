'use client';

import type { LobbyFill } from '@/hooks/useNextLobbyFill';

/**
 * How full the next lobby is, as a hairline track plus the raw count —
 * Underdog's fill bar at about a fifth the size.
 *
 * Deliberately WHITE, not banana: the drafting page already spends banana on
 * the things you're meant to press, and a yellow bar next to an Enter button
 * reads as a second call to action. This is meant to be noticed in passing and
 * ignored the rest of the time.
 *
 * Renders nothing when there's nothing to say (`fill` is null) — see
 * useNextLobbyFill for when that happens.
 */
export function LobbyFillBar({ fill, className = '' }: { fill: LobbyFill | null; className?: string }) {
  if (!fill) return null;

  const pct = Math.max(0, Math.min(100, Math.round((fill.seats / fill.maxSeats) * 100)));

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role="img"
      aria-label={`Next lobby: ${fill.seats} of ${fill.maxSeats} seats taken`}
    >
      <span aria-hidden="true" className="block h-[3px] w-9 overflow-hidden rounded-full bg-white/10">
        {/* Width is already final on first paint, so the bar doesn't sweep in on
            every mount (that reads as a loading spinner) — it only eases when a
            seat is actually taken while you're looking at it. */}
        <span
          className="block h-full rounded-full bg-white/45 motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span aria-hidden="true" className="text-[11px] tabular-nums text-white/40">
        {fill.seats}/{fill.maxSeats}
      </span>
    </span>
  );
}
