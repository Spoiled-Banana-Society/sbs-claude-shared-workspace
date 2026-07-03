/**
 * The SBS business day starts at 3:00 AM Pacific (Boris: "start a day like
 * 3am PT"), so late-night activity counts toward the evening's day, not a
 * fresh one. Every admin surface that says "today" must use this boundary —
 * a rolling last-24h window disagrees with these numbers and looks like a bug.
 */

export const LAUNCH_ISO = '2026-06-23T00:00:00.000Z';

const DAY_START_HOUR_PT = 3;

/** ISO instant of the most recent 3:00 AM Pacific. */
export function sbsDayStartIso(now = new Date()): string {
  // Get the current wall-clock parts in LA (handles PDT/PST automatically).
  const la = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  // LA date, possibly rolled back a day if before 3am LA time.
  let y = Number(la.year), m = Number(la.month), d = Number(la.day);
  if (Number(la.hour) < DAY_START_HOUR_PT) {
    const rolled = new Date(Date.UTC(y, m - 1, d));
    rolled.setUTCDate(rolled.getUTCDate() - 1);
    y = rolled.getUTCFullYear(); m = rolled.getUTCMonth() + 1; d = rolled.getUTCDate();
  }

  // Find the UTC instant when LA wall-clock hits 3:00 on (y,m,d): LA is
  // UTC-7 (PDT) or UTC-8 (PST); try both and keep the one that round-trips.
  for (const offset of [7, 8]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR_PT + offset, 0, 0));
    const check = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(candidate).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (Number(check.hour) === DAY_START_HOUR_PT && Number(check.day) === d) return candidate.toISOString();
  }
  // Unreachable fallback: UTC-7.
  return new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR_PT + 7, 0, 0)).toISOString();
}
