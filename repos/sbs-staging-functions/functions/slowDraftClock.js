/**
 * Slow-draft pick clock: only 05:00–22:00 America/Los_Angeles counts
 * (22:00–05:00 PT paused). JS port of banana-fantasy utils/slowDraftClock.ts,
 * which mirrors sbs-drafts-api/models/slow_draft_clock.go — keep all three in
 * sync. Only the pieces the bot brain needs are ported.
 */

const PACIFIC = "America/Los_Angeles";

function nyWallFromUnixSec(unixSec) {
  const ms = unixSec * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") {
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

function compareNYWall(a, y, mon, d, sod) {
  if (a.y !== y) return a.y - y;
  if (a.mon !== mon) return a.mon - mon;
  if (a.d !== d) return a.d - d;
  return a.sod - sod;
}

function unixAtNYWallClock(y, mon, d, hour, minute, second) {
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

function addCalendarDays(y, mon, d, deltaDays) {
  const dt = new Date(Date.UTC(y, mon - 1, d + deltaDays));
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function inNightPause(w) {
  return w.sod >= 22 * 3600 || w.sod < 5 * 3600;
}

function advanceToNextActiveUnix(unixSec) {
  const w = nyWallFromUnixSec(unixSec);
  if (!inNightPause(w)) return unixSec;
  if (w.sod >= 22 * 3600) {
    const [y2, m2, d2] = addCalendarDays(w.y, w.mon, w.d, 1);
    return unixAtNYWallClock(y2, m2, d2, 5, 0, 0);
  }
  return unixAtNYWallClock(w.y, w.mon, w.d, 5, 0, 0);
}

function slowDraftEffectiveElapsedSeconds(startUnix, endUnix) {
  if (endUnix <= startUnix) return 0;
  let total = 0;
  let cur = advanceToNextActiveUnix(startUnix);
  while (cur < endUnix) {
    const w = nyWallFromUnixSec(cur);
    const windowClose = unixAtNYWallClock(w.y, w.mon, w.d, 22, 0, 0);
    if (windowClose <= cur) {
      const [y2, m2, d2] = addCalendarDays(w.y, w.mon, w.d, 1);
      cur = unixAtNYWallClock(y2, m2, d2, 5, 0, 0);
      continue;
    }
    let chunkEnd = windowClose;
    if (endUnix < chunkEnd) chunkEnd = endUnix;
    total += chunkEnd - cur;
    if (chunkEnd >= endUnix) break;
    const [y3, m3, d3] = addCalendarDays(w.y, w.mon, w.d, 1);
    cur = unixAtNYWallClock(y3, m3, d3, 5, 0, 0);
  }
  return total;
}

/** True if `nowUnixSec` falls inside the slow-draft night pause (22:00–05:00 PT). */
function isSlowDraftNightPause(nowUnixSec) {
  return inNightPause(nyWallFromUnixSec(nowUnixSec));
}

/**
 * Active (non-paused) seconds remaining from `nowUnixSec` until the pick
 * expires at `pickEndUnixSec` — exactly the number the draft-room clock shows.
 */
function slowDraftActiveSecondsUntil(nowUnixSec, pickEndUnixSec) {
  return slowDraftEffectiveElapsedSeconds(nowUnixSec, pickEndUnixSec);
}

module.exports = { isSlowDraftNightPause, slowDraftActiveSecondsUntil };
