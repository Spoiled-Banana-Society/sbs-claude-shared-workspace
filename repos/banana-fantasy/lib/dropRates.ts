/**
 * THE DROP — rates and schedule ONLY. No imports, no Node built-ins.
 *
 * ⚠️ This file exists so CLIENT components can compute the countdown and show
 * the rates. lib/dropMath imports `node:crypto` for the prize assignment, and
 * webpack cannot bundle a `node:` scheme for the browser — importing dropMath
 * from a 'use client' component fails the build and 500s the whole route. That
 * exact mistake shipped once already on the Eliminator (2026-07-31).
 *
 * Anything the UI needs lives here; anything that needs crypto stays in
 * dropMath, which re-exports these so server callers only import one module.
 */

// ── Earning ─────────────────────────────────────────────────────────────────
// Only FILLED drafts pay. Entering earns nothing: leaving a filling lobby
// refunds the pass, so crediting on entry is farmable — enter, earn, leave,
// repeat, free. Buying a pass earns nothing either; the reward is for PLAYING.
export const PACKS_PAID_FILL = 2;
export const PACKS_FREE_FILL = 1;

export function packsForFill(passType: 'free' | 'paid'): number {
  return passType === 'paid' ? PACKS_PAID_FILL : PACKS_FREE_FILL;
}

// ── Schedule ────────────────────────────────────────────────────────────────
// Packs unlock at 8pm PT. 9pm was the first plan and it was wrong: activity
// peaks 5-8pm (332/378/292/367 events per hour over 14 days) and falls off a
// cliff to 153 by 9pm, so a 9pm drop lands after the room has emptied.
export const DROP_HOUR_PT = 20;
/** Anything still sealed at midnight opens itself. */
export const AUTO_OPEN_HOUR_PT = 24;

/** UTC instant when LA wall-clock hits `hour` on the given y/m/d.
 *  LA is UTC-7 (PDT) or UTC-8 (PST) — try both and keep the one that
 *  round-trips, so this survives the November DST change. */
export function ptHourUtc(y: number, m: number, d: number, hour: number): number {
  for (const offset of [7, 8]) {
    const candidate = Date.UTC(y, m - 1, d, hour + offset, 0, 0);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(new Date(candidate))
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (Number(parts.hour) === hour && Number(parts.day) === d) return candidate;
  }
  return Date.UTC(y, m - 1, d, hour + 7, 0, 0); // unreachable fallback: PDT
}

function ptParts(nowMs: number) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs))
    .reduce<Record<string, string>>((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) };
}

export interface DropNight {
  /** PT date the night belongs to, e.g. "2026-08-02". Doc id. */
  nightId: string;
  /** 8pm PT — the night locks and prizes are assigned. */
  locksAt: number;
  /** Midnight PT — anything still sealed opens itself. */
  autoOpensAt: number;
}

/**
 * Which night a pack earned at `nowMs` belongs to.
 *
 * ⚠️ Rolls to TOMORROW once 8pm has passed. A pack earned at 8:30pm cannot join
 * tonight's pool — it was already locked and its prizes assigned.
 */
export function nightIdFor(nowMs: number): string {
  const { y, m, d, hour } = ptParts(nowMs);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (hour >= DROP_HOUR_PT) date.setUTCDate(date.getUTCDate() + 1);
  const cy = date.getUTCFullYear();
  const cm = date.getUTCMonth() + 1;
  const cd = date.getUTCDate();
  return `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
}

/**
 * The night you can OPEN right now — the PT calendar date, with NO roll.
 *
 * ⚠️ Distinct from nightIdFor() on purpose. nightIdFor rolls forward at 8pm so
 * a pack earned at 8:30pm joins TOMORROW's pool (tonight's prizes are already
 * assigned). But the reveal room must keep showing TONIGHT's packs from 8pm
 * until they auto-open at midnight — using nightIdFor there made the page flip
 * to an empty night the instant the clock hit 8:00:00, hiding every pack
 * people had waited all day to rip (caught 2026-08-02, before it ever fired).
 *
 * Before 8pm the two agree. Between 8pm and midnight they differ — that window
 * is exactly when you're revealing one night while earning into the next.
 */
export function revealNightIdFor(nowMs: number): string {
  const { y, m, d } = ptParts(nowMs);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function nightFromId(nightId: string): DropNight {
  const [y, m, d] = nightId.split('-').map(Number);
  return {
    nightId,
    locksAt: ptHourUtc(y, m, d, DROP_HOUR_PT),
    autoOpensAt: ptHourUtc(y, m, d, DROP_HOUR_PT) + (AUTO_OPEN_HOUR_PT - DROP_HOUR_PT) * 3600_000,
  };
}

export function nightFor(nowMs: number): DropNight {
  return nightFromId(nightIdFor(nowMs));
}

/** Milliseconds until tonight's 8pm unlock. 0 once it has passed. */
export function msUntilDrop(nowMs = Date.now()): number {
  return Math.max(0, nightFor(nowMs).locksAt - nowMs);
}

/**
 * Milliseconds until the pack room OPENS — 0 from 8pm until midnight.
 *
 * ⚠️ Use this for anything a player LOOKS at, not msUntilDrop(). msUntilDrop is
 * built on nightFor(), which rolls forward at 8pm — so at 8:00:00 it returns
 * ~24h and a countdown built on it jumps from 0:00:01 straight to 23:59:59 at
 * the exact moment the drop is supposed to be happening (Richard caught this
 * 2026-08-02: "your gonna reset the clock at 8:00:00 starting to cowndown 24
 * hours?"). Keyed to the REVEAL night instead, this correctly reads 0 through
 * the whole open window and only starts counting again after midnight.
 */
export function msUntilOpen(nowMs = Date.now()): number {
  return Math.max(0, nightFromId(revealNightIdFor(nowMs)).locksAt - nowMs);
}

/** "3:42:07" — the countdown as shown on the promo card. */
export function formatOpenCountdown(nowMs = Date.now()): string {
  const ms = msUntilOpen(nowMs);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Countdown to the next EARNING deadline. Rolls at 8pm — server-side use. */
export function formatDropCountdown(nowMs = Date.now()): string {
  const ms = msUntilDrop(nowMs);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── What goes out every night ───────────────────────────────────────────────
// Client-safe description of the pool, so the page and the modal can list the
// prizes without importing lib/dropMath (which pulls in node:crypto).
//
// ⚠️ lib/dropMath builds NIGHTLY_POOL from this, so the two can never drift —
// change a count here and the real assignment changes with it.
export const NIGHTLY_PRIZES: Array<{ label: string; count: number; spins?: number; kind: 'jackhof' | 'hof' | 'spins' }> = [
  { kind: 'jackhof', label: 'JACKHOF SEAT', count: 1 },
  { kind: 'hof', label: 'HOF SEAT', count: 1 },
  { kind: 'spins', label: '5 SPINS', count: 1, spins: 5 },
  { kind: 'spins', label: '2 SPINS', count: 2, spins: 2 },
  { kind: 'spins', label: '1 SPIN', count: 6, spins: 1 },
];

/** Total winning packs per night. */
export const WINNING_PACKS_PER_NIGHT = NIGHTLY_PRIZES.reduce((s, p) => s + p.count, 0);
/** Total spins handed out per night. */
export const SPINS_PER_NIGHT = NIGHTLY_PRIZES
  .reduce((s, p) => s + p.count * (p.spins ?? 0), 0);
