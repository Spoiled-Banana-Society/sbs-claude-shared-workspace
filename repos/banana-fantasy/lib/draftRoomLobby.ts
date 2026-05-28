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

/** How long after joining we treat a downward live reading as a stale dip. */
export const JOIN_COUNT_GRACE_MS = 2500;

/**
 * Reconcile a live count reading (RTDB push or poll) into the current count
 * during filling.
 *
 * Upward readings are always accepted immediately (a new joiner). A *downward*
 * reading is ambiguous: it's either a stale post-join dip (the RTDB
 * subscription attaching right after join reads the pre-increment value before
 * our own bump propagates) or a genuine leave. We distinguish them by time
 * since *this client* joined: within the grace window → treat as the stale dip
 * and keep the higher count (kills the "2 → 1 → 2" box flicker); after the
 * grace window → accept the decrease so leaves update live for everyone.
 *
 * `prev` null means nothing known yet. `msSinceJoin` should be large
 * (effectively Infinity) for clients that have been in the lobby a while, so
 * they always see leaves immediately.
 */
export function reconcileLiveCount(
  prev: number | null,
  incoming: number,
  msSinceJoin: number,
  graceMs: number = JOIN_COUNT_GRACE_MS,
): number {
  const cur = prev ?? 0;
  if (incoming >= cur) return incoming; // joiners (and no-change) always win
  // incoming < cur → a decrease.
  return msSinceJoin >= graceMs ? incoming : cur;
}

/**
 * Pick the anchor (epoch ms) the randomize bar measures its progress from.
 *
 * Prefer the backend's shared `randomizeStartAt` (RTDB) so EVERY client's bar
 * runs on the same clock and reveals together — including the 10th joiner, who
 * reads the same value and snaps to the correct elapsed position. Fall back to
 * a previously-stored local anchor (resume), then to `now` (old backend with
 * no shared value, so nothing breaks during the deploy crossover).
 *
 * Only the START anchor is chosen here; the existing bar-finish, reveal, and
 * 15s/60s countdown logic are unchanged and stay anchored to the server's
 * draftStartTime.
 */
export function resolveRandomizeAnchor(
  sharedMs: number | null | undefined,
  storedMs: number | null | undefined,
  nowMs: number,
): number {
  if (typeof sharedMs === 'number' && sharedMs > 0) return sharedMs;
  if (typeof storedMs === 'number' && storedMs > 0) return storedMs;
  return nowMs;
}
