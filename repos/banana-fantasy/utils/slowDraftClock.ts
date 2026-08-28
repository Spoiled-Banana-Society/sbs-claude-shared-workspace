/**
 * Slow-draft pick clock: only 05:00–22:00 America/Los_Angeles counts (22:00–05:00 PT paused).
 * Mirrors sbs-drafts-api/models/slow_draft_clock.go — keep in sync.
 */

const PACIFIC = 'America/Los_Angeles';
const PAUSE_START_HOUR = 22;

/**
 * PT hour the overnight pause ends. Legacy 5. The SlowClockProvider sets it
 * from system_config/slowDraftClock.pauseEndHour when the switch is active
 * (Richard 8/26: 7). Every helper takes it as an optional trailing arg and
 * defaults to this module value, so callers don't have to thread it through.
 */
let defaultPauseEndHour = 5;
export function setSlowDraftPauseEndHour(h: number): void {
  if (Number.isInteger(h) && h > 0 && h < PAUSE_START_HOUR) defaultPauseEndHour = h;
}
export function getSlowDraftPauseEndHour(): number {
  return defaultPauseEndHour;
}

type NYWall = { y: number; mon: number; d: number; sod: number };

function nyWallFromUnixSec(unixSec: number): NYWall {
  const ms = unixSec * 1000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const y = Number(map.year);
  const mon = Number(map.month);
  const d = Number(map.day);
  // Intl returns '24' instead of '00' for midnight in 24-hour mode; normalize.
  const h = Number(map.hour) % 24;
  const min = Number(map.minute);
  const s = Number(map.second);
  const sod = h * 3600 + min * 60 + s;
  return { y, mon, d, sod };
}

function compareNYWall(a: NYWall, y: number, mon: number, d: number, sod: number): number {
  if (a.y !== y) return a.y - y;
  if (a.mon !== mon) return a.mon - mon;
  if (a.d !== d) return a.d - d;
  return a.sod - sod;
}

function unixAtNYWallClock(
  y: number,
  mon: number,
  d: number,
  hour: number,
  minute: number,
  second: number
): number {
  const targetSod = hour * 3600 + minute * 60 + second;
  const noonUtcGuess = Math.floor(Date.UTC(y, mon - 1, d, 12, 0, 0) / 1000);
  let lo = noonUtcGuess - 20 * 3600;
  let hi = noonUtcGuess + 20 * 3600;
  let ans = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const w = nyWallFromUnixSec(mid);
    const c = compareNYWall(w, y, mon, d, targetSod);
    if (c < 0) {
      lo = mid + 1;
    } else {
      ans = mid;
      hi = mid - 1;
    }
  }
  if (ans === -1) {
    throw new Error(`unixAtNYWallClock: no match for ${y}-${mon}-${d} ${hour}:${minute}:${second}`);
  }
  return ans;
}

function addCalendarDays(
  y: number,
  mon: number,
  d: number,
  deltaDays: number
): [number, number, number] {
  const dt = new Date(Date.UTC(y, mon - 1, d + deltaDays));
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function inNightPause(w: NYWall, pauseEndHour: number): boolean {
  return w.sod >= PAUSE_START_HOUR * 3600 || w.sod < pauseEndHour * 3600;
}

function advanceToNextActiveUnix(unixSec: number, pauseEndHour: number): number {
  const w = nyWallFromUnixSec(unixSec);
  if (!inNightPause(w, pauseEndHour)) return unixSec;
  if (w.sod >= PAUSE_START_HOUR * 3600) {
    const [y2, m2, d2] = addCalendarDays(w.y, w.mon, w.d, 1);
    return unixAtNYWallClock(y2, m2, d2, pauseEndHour, 0, 0);
  }
  return unixAtNYWallClock(w.y, w.mon, w.d, pauseEndHour, 0, 0);
}


/**
 * `freshAfterPause` (system_config/slowDraftClock.freshClockAfterPause): a pick
 * that would cross the 22:00 PT pause does NOT carry its leftover minutes into
 * the morning — it restarts with the FULL pickLengthSec at 05:00 PT. Default
 * false = legacy carry-over. Mirrors slowDraftPickEndUnixOpts in Go.
 */
export function slowDraftPickEndUnix(fromUnix: number, pickLengthSec: number, freshAfterPause = false, pauseEndHour: number = defaultPauseEndHour): number {
  if (pickLengthSec <= 0) return fromUnix;
  // Longest pick that still fits one active window — beyond it a fresh clock could never end.
  if (pickLengthSec > (PAUSE_START_HOUR - pauseEndHour) * 3600) freshAfterPause = false;
  let cur = advanceToNextActiveUnix(fromUnix, pauseEndHour);
  let remaining = pickLengthSec;
  while (remaining > 0) {
    const w = nyWallFromUnixSec(cur);
    const windowClose = unixAtNYWallClock(w.y, w.mon, w.d, PAUSE_START_HOUR, 0, 0);
    const avail = windowClose - cur;
    if (avail <= 0) {
      const [y2, m2, d2] = addCalendarDays(w.y, w.mon, w.d, 1);
      cur = unixAtNYWallClock(y2, m2, d2, pauseEndHour, 0, 0);
      continue;
    }
    if (remaining <= avail) {
      return cur + remaining;
    }
    remaining = freshAfterPause ? pickLengthSec : remaining - avail;
    const [y3, m3, d3] = addCalendarDays(w.y, w.mon, w.d, 1);
    cur = unixAtNYWallClock(y3, m3, d3, pauseEndHour, 0, 0);
  }
  return cur;
}

export function slowDraftEffectiveElapsedSeconds(startUnix: number, endUnix: number, pauseEndHour: number = defaultPauseEndHour): number {
  if (endUnix <= startUnix) return 0;
  let total = 0;
  let cur = advanceToNextActiveUnix(startUnix, pauseEndHour);
  while (cur < endUnix) {
    const w = nyWallFromUnixSec(cur);
    const windowClose = unixAtNYWallClock(w.y, w.mon, w.d, PAUSE_START_HOUR, 0, 0);
    if (windowClose <= cur) {
      const [y2, m2, d2] = addCalendarDays(w.y, w.mon, w.d, 1);
      cur = unixAtNYWallClock(y2, m2, d2, pauseEndHour, 0, 0);
      continue;
    }
    let chunkEnd = windowClose;
    if (endUnix < chunkEnd) chunkEnd = endUnix;
    total += chunkEnd - cur;
    if (chunkEnd >= endUnix) break;
    const [y3, m3, d3] = addCalendarDays(w.y, w.mon, w.d, 1);
    cur = unixAtNYWallClock(y3, m3, d3, pauseEndHour, 0, 0);
  }
  return total;
}

export function slowDraftDisplayedSecondsRemaining(
  nowUnixSec: number,
  pickStartUnixSec: number,
  pickLengthSec: number,
  pauseEndHour: number = defaultPauseEndHour
): number {
  const elapsed = slowDraftEffectiveElapsedSeconds(pickStartUnixSec, nowUnixSec, pauseEndHour);
  return Math.max(0, Math.floor(pickLengthSec - elapsed));
}

export function isSlowDraftPickLength(pickLengthSec: number): boolean {
  return pickLengthSec >= 3600;
}

/** True if `nowUnixSec` falls inside the slow-draft night pause (22:00–05:00 PT). */
export function isSlowDraftNightPause(nowUnixSec: number, pauseEndHour: number = defaultPauseEndHour): boolean {
  return inNightPause(nyWallFromUnixSec(nowUnixSec), pauseEndHour);
}

/**
 * Active (non-paused) seconds remaining from `nowUnixSec` until the pick expires
 * at `pickEndUnixSec`. This is what a slow-draft countdown should display: it
 * reads the full pick length at the start, ticks down only during active hours,
 * and freezes overnight.
 */
export function slowDraftActiveSecondsUntil(nowUnixSec: number, pickEndUnixSec: number, pauseEndHour: number = defaultPauseEndHour): number {
  return slowDraftEffectiveElapsedSeconds(nowUnixSec, pickEndUnixSec, pauseEndHour);
}

/** Seconds from `nowUnixSec` until tonight's 22:00 PT pause starts; 0 while paused. */
export function slowDraftSecondsUntilPause(nowUnixSec: number, pauseEndHour: number = defaultPauseEndHour): number {
  const w = nyWallFromUnixSec(nowUnixSec);
  if (inNightPause(w, pauseEndHour)) return 0;
  return Math.max(0, unixAtNYWallClock(w.y, w.mon, w.d, PAUSE_START_HOUR, 0, 0) - nowUnixSec);
}

/**
 * What a slow-draft clock should DISPLAY. Normally the active seconds left
 * (ticks in active hours, frozen overnight). With the fresh-clock-after-pause
 * rule a pick armed after (22:00 − pickLength) has MORE active time than one
 * clock: tonight's remainder PLUS a full clock at pauseEnd. Capping that at
 * pickLength (the pre-8/27 behavior) showed a flat "4:00:00" from ~6pm until
 * 7am — every user read it as frozen (ticket-2661). Richard 8/27: "it should
 * still count down." So while there is more than one clock ahead, count down
 * to the pause (tonight's real remaining), then the full clock shows through
 * the pause and ticks from pauseEnd. Never returns 0 before the pause: 0 flips
 * canDraft off in the room for the final second, so the floor is 1.
 */
export function slowDraftDisplaySecondsUntil(
  nowUnixSec: number,
  pickEndUnixSec: number,
  pickLengthSec: number,
  pauseEndHour: number = defaultPauseEndHour
): number {
  const active = slowDraftActiveSecondsUntil(nowUnixSec, pickEndUnixSec, pauseEndHour);
  if (!(pickLengthSec > 0) || active <= pickLengthSec) return active;
  const toPause = slowDraftSecondsUntilPause(nowUnixSec, pauseEndHour);
  return toPause > 0 ? Math.max(1, toPause) : pickLengthSec;
}
