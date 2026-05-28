// Pure helpers for the draft lobby's "instant render" behavior.
//
// The lobby must never render a known-false count. Before the join response
// (or stored state) tells us the real number of players, the count is
// *unknown* — represented as `null` — and the UI shows a subtle pulse instead
// of a fabricated "1/10". As soon as the real count arrives (from the join
// response, the RTDB subscription, or the poll) the number fades in.
//
// Extracted from app/draft-room/page.tsx so the logic is unit-testable in the
// node test environment without mounting the (very large) draft-room page.

export interface InitialPlayerCountArgs {
  /** Stored room phase from draftStore, if any. */
  storedPhase?: string | null;
  /** Stored player count from a previous session for this draft, if any. */
  storedPlayers?: number | null;
  /** Count optimistically passed into the room (e.g. from a draft row), if any. */
  initialPlayers?: number | null;
}

/**
 * Initial value for the lobby's playerCount state.
 *
 * Returns `null` when the count is genuinely unknown so the UI renders a pulse
 * rather than the old hardcoded `1` fallback (the cause of the "1/10 → 6/10"
 * flash). Returns 10 once the room has advanced past filling.
 */
export function computeInitialPlayerCount(args: InitialPlayerCountArgs): number | null {
  const { storedPhase, storedPlayers, initialPlayers } = args;
  if (storedPhase && storedPhase !== 'filling') return 10;
  const known = storedPlayers || initialPlayers;
  if (known && known > 0) return Math.min(Math.max(known, 1), 10);
  return null; // unknown — render a pulse, never a false "1"
}

/**
 * Whether to display the numeric count vs. a loading pulse. A meaningful lobby
 * always has at least one player (you), so `null`/`0` mean "not known yet".
 */
export function shouldShowPlayerCount(playerCount: number | null): boolean {
  return playerCount != null && playerCount > 0;
}

/**
 * Parse the `players` URL hint into a known count or null. Absent/empty/invalid
 * → null ("unknown"), so the lobby pulses instead of flashing a default "1".
 * This is the value that previously defaulted to `1` and caused the flash even
 * after computeInitialPlayerCount stopped hardcoding 1.
 */
export function parseInitialPlayers(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Merge a live count reading (from the RTDB push or the poll) into the current
 * count during filling. The count only ever climbs while a lobby fills, so a
 * reading LOWER than what we already know is stale (e.g. the RTDB subscription
 * attaching right after join reads the pre-increment value before our own
 * join's bump has propagated). Taking the max prevents the "shows 2, snaps
 * back to 1, then 2 again" box flicker. `prev` null means nothing known yet.
 */
export function mergePlayerCount(prev: number | null, incoming: number): number {
  return Math.max(prev ?? 0, incoming);
}
