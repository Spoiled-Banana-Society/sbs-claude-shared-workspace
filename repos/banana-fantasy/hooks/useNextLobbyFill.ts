'use client';

import { useEffect, useState } from 'react';
import * as draftStore from '@/lib/draftStore';

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
export function useNextLobbyFill(enabled = true): { fast: LobbyFill | null; slow: LobbyFill | null } {
  const [open, setOpen] = useState<{ fast: OpenLobby[]; slow: OpenLobby[] }>({ fast: [], slow: [] });
  // Slot ids this device is already sitting in — the matchmaker skips them.
  const [joinedIds, setJoinedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch('/api/drafts/next-lobby');
        if (!res.ok) return;
        const body = (await res.json()) as { fast?: OpenLobby[]; slow?: OpenLobby[] };
        if (cancelled) return;
        setOpen({ fast: body.fast ?? [], slow: body.slow ?? [] });
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

  useEffect(() => {
    const read = () => {
      try {
        setJoinedIds(new Set(draftStore.getActiveDrafts().map((d) => d.id)));
      } catch {
        setJoinedIds(new Set());
      }
    };
    read();
    return draftStore.subscribe(read);
  }, []);

  const pick = (lobbies: OpenLobby[]): LobbyFill | null => {
    const next = lobbies.filter((l) => !joinedIds.has(l.id)).sort((a, b) => a.slot - b.slot)[0];
    if (!next || next.seats < MIN_SEATS_TO_SHOW) return null;
    return { seats: next.seats, maxSeats: next.maxSeats };
  };

  return { fast: pick(open.fast), slow: pick(open.slow) };
}
