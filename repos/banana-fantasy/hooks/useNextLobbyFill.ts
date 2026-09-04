'use client';

import { useEffect, useState } from 'react';

export interface LobbyFill {
  seats: number;
  maxSeats: number;
}

interface OpenLobby {
  id: string;
  slot: number;
  seats: number;
  maxSeats: number;
}

/** How often the open-lobby list is refreshed while the widget is mounted. */
const POLL_MS = 12_000;

/**
 * Below this, the lane renders nothing.
 *
 * This used to be 2 — the worry was that a bar at 1 of 10 makes a new lane look
 * dead. In practice it read as a bug instead: the count appeared to start at
 * 2/10 and there was no way to tell "one person waiting" from "nobody here",
 * which is exactly the question you ask before you press Enter. 1 is a real
 * number of people in the lobby, so we show it.
 */
const MIN_SEATS_TO_SHOW = 1;

/**
 * How full the lobby you'd land in is, per speed — `null` for a lane with
 * nothing worth showing.
 *
 * Mirrors the matchmaker (Go models.scanForPartialLeague): you're placed in the
 * LOWEST-numbered partially-filled lobby you are NOT already in, so drafts this
 * device has already joined are dropped before picking. Everything about the
 * lane is speed-only — paid and free passes join the SAME lobbies
 * (`/league/{speed}/owner/{wallet}`; passType only decides which pass burns),
 * so there is no paid-vs-free number to show.
 *
 * Render-loop safety (Rule #0): the fetch effect has EMPTY deps and reads
 * nothing derived from Privy. `enabled` is the only gate and it's a plain
 * boolean checked inside the tick, so nothing here can re-fire per render.
 */
export function useNextLobbyFill(enabled = true): {
  fast: LobbyFill | null;
  slow: LobbyFill | null;
  /**
   * Regular slow drafts closed (Richard 2026-09-03). The route already trims
   * `slow` to the one lobby still allowed to fill, so `regularSlowClosed &&
   * !slow` means: no slow button, nothing slow to join.
   */
  regularSlowClosed: boolean;
} {
  const [open, setOpen] = useState<{ fast: OpenLobby[]; slow: OpenLobby[]; regularSlowClosed: boolean }>({ fast: [], slow: [], regularSlowClosed: false });
  // Slot ids this device is already sitting in — the matchmaker skips them.

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch('/api/drafts/next-lobby');
        if (!res.ok) return;
        const body = (await res.json()) as { fast?: OpenLobby[]; slow?: OpenLobby[]; regularSlowClosed?: boolean };
        if (cancelled) return;
        setOpen({ fast: body.fast ?? [], slow: body.slow ?? [], regularSlowClosed: body.regularSlowClosed === true });
      } catch {
        // Offline / aborted — keep the last good value rather than blinking out.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);


  const pick = (lobbies: OpenLobby[]): LobbyFill | null => {
    // FULLEST open lobby you're not already in, ties → lowest slot. The old
    // "lowest slot" rule showed fast-680 at 1/10 while four players had just
    // landed in fast-681 at 5/10 (Boris 2026-08-18) — the engine keeps
    // filling the fuller lobby, so that's the one that starts next.
    // GLOBAL view (Boris 2026-08-18): the fullest open lobby per speed, the
    // same number for everyone. It used to skip lobbies YOU were already
    // seated in, so the heaviest drafters (in the most lobbies) saw the
    // emptiest numbers — Fantasy Couch saw Slow 2/10 while everyone else saw
    // 5/10 and read it as a glitch. The engine may still seat a double-entrant
    // elsewhere; the bar's job is "how full is the lobby that's filling".
    const next = [...lobbies].sort((a, b) => (b.seats - a.seats) || (a.slot - b.slot))[0];
    if (!next || next.seats < MIN_SEATS_TO_SHOW) return null;
    return { seats: next.seats, maxSeats: next.maxSeats };
  };

  return { fast: pick(open.fast), slow: pick(open.slow), regularSlowClosed: open.regularSlowClosed };
}
