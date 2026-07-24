// Live draft-activity line — a "keep waiting" nudge showing how many FAST drafts
// are in progress and the furthest-along round ("5 drafts going · a draft is on
// Round 14"). The whole feature is DARK unless the Vercel env var
// NEXT_PUBLIC_LIVE_ACTIVITY_ENABLED is exactly 'true'. Flipping it off removes the
// line from every surface (lobby, draft room, fill-alert feed) instantly, no
// redeploy — same kill-switch shape as DEPOSITS_ENABLED.
export const LIVE_ACTIVITY_ENABLED =
  process.env.NEXT_PUBLIC_LIVE_ACTIVITY_ENABLED === 'true';

// RTDB node the Go aggregator publishes to (kept here so the client and any
// server reader reference one constant).
export const LIVE_ACTIVITY_RTDB_PATH = '/stats/liveDraftActivity';

// Fail-closed staleness: if no fresh write arrives within this window, hide the
// line rather than show a frozen number. The aggregator rewrites every ~10s, so
// 45s tolerates several missed ticks before hiding.
export const LIVE_ACTIVITY_STALE_MS = 45_000;

// How often the client re-checks staleness (cheap, no network — just a clock
// comparison that may hide a now-stale value).
export const LIVE_ACTIVITY_STALE_CHECK_MS = 5_000;

/** The one canonical string, shared by every surface so they read identically. */
export function formatLiveActivity(count: number, round: number): string {
  const noun = count === 1 ? 'draft' : 'drafts';
  return `${count} ${noun} going · a draft is on Round ${round}`;
}
