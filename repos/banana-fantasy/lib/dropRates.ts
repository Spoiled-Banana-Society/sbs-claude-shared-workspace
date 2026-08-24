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
// PAID drafts only (Boris 2026-08-22): 1 paid fill = 1 pack, free/wheel earn
// nothing — every promo is paid-gated now. (Launch rates were paid 2 / free 1.)
export const PACKS_PAID_FILL = 1;
export const PACKS_FREE_FILL = 0;

export function packsForFill(passType: 'free' | 'paid'): number {
  return passType === 'paid' ? PACKS_PAID_FILL : PACKS_FREE_FILL;
}

// ── Schedule ────────────────────────────────────────────────────────────────
// Packs unlock at 9pm PT (Boris 2026-08-05: moved from 8pm so the earning
// window covers the whole 5-8pm activity peak plus the 8-9 hour; the countdown
// rolls to a clean 24h at each 9pm open).
export const DROP_HOUR_PT = 21;

// ── Retirement ──────────────────────────────────────────────────────────────
// THE DROP's 2026-08-23 night is its LAST (Richard 8/23) — Golden Tickets
// inside the Banana Zone replace it. Fills after that night's 9pm lock earn
// NO old-style packs, and no later night doc is ever created. Unopened packs
// from any past night stay openable forever ("you never lose what you
// earned") — the reveal room keeps serving them.
export const DROP_FINAL_NIGHT_ID = '2026-08-23';

/** True once earning is over — the first fill AFTER the final night's 9pm
 *  lock (nightIdFor rolls to the next id at 9pm, so a plain string compare
 *  against the final id is exact). */
export function dropEarningRetired(nowMs = Date.now()): boolean {
  return nightIdFor(nowMs) > DROP_FINAL_NIGHT_ID;
}
/** ⚠️ LEGACY (removed 2026-08-03): packs used to auto-open at midnight. They
 *  now stay sealed until the owner opens them — there is NO backstop, by
 *  Richard's call ("no backstop window at all"). The constant and the
 *  autoOpensAt field survive only because existing night docs and clients
 *  carry them; nothing acts on them anymore. */
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
  /** Legacy — the old midnight auto-open instant. No longer acted on. */
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
export interface NightlyPrizeRow {
  label: string;
  count: number;
  spins?: number;
  kind: 'jackpot' | 'jackhof' | 'hof' | 'spins';
}

export const NIGHTLY_PRIZES: NightlyPrizeRow[] = [
  { kind: 'jackhof', label: 'JACKHOF SEAT', count: 1 },
  { kind: 'hof', label: 'HOF SEAT', count: 1 },
  { kind: 'spins', label: '5 SPINS', count: 1, spins: 5 },
  { kind: 'spins', label: '2 SPINS', count: 2, spins: 2 },
  { kind: 'spins', label: '1 SPIN', count: 6, spins: 1 },
];

// One-night boosts, keyed by nightId (PT date). The override IS the whole
// pool for that night, not a delta — what's listed here is exactly what the
// lock assigns and the page shows. Past-night entries are inert (their lock
// already ran); prune whenever convenient.
export const NIGHT_PRIZE_OVERRIDES: Record<string, NightlyPrizeRow[]> = {
  // Boris 2026-08-03: ~20 drafts by 3pm → +1 Jackpot seat, 1-spins 6→16.
  '2026-08-03': [
    { kind: 'jackhof', label: 'JACKHOF SEAT', count: 1 },
    { kind: 'jackpot', label: 'JACKPOT SEAT', count: 1 },
    { kind: 'hof', label: 'HOF SEAT', count: 1 },
    { kind: 'spins', label: '5 SPINS', count: 1, spins: 5 },
    { kind: 'spins', label: '2 SPINS', count: 2, spins: 2 },
    { kind: 'spins', label: '1 SPIN', count: 16, spins: 1 },
  ],
};

/** The pool for a given night — override if one exists, default otherwise. */
export function nightlyPrizesFor(nightId: string): NightlyPrizeRow[] {
  return NIGHT_PRIZE_OVERRIDES[nightId] ?? NIGHTLY_PRIZES;
}

/** Total winning packs per night. */
export const WINNING_PACKS_PER_NIGHT = NIGHTLY_PRIZES.reduce((s, p) => s + p.count, 0);
/** Total spins handed out per night. */
export const SPINS_PER_NIGHT = NIGHTLY_PRIZES
  .reduce((s, p) => s + p.count * (p.spins ?? 0), 0);

export function winningPacksForNight(nightId: string): number {
  return nightlyPrizesFor(nightId).reduce((s, p) => s + p.count, 0);
}
export function spinsForNight(nightId: string): number {
  return nightlyPrizesFor(nightId).reduce((s, p) => s + p.count * (p.spins ?? 0), 0);
}

/**
 * The promo modal's explanation text, built from the night's ACTUAL pool so
 * the copy can never drift from what the lock assigns (per-user promo docs
 * are seeded copies — the /api/promos route overwrites this field live).
 */
export function dropExplanationFor(nightId: string): string {
  const lines = nightlyPrizesFor(nightId).map((p) => {
    if (p.kind === 'spins') {
      return `• ${p.count} pack${p.count === 1 ? '' : 's'} with ${p.spins} SPIN${(p.spins ?? 0) === 1 ? '' : 'S'}${p.count === 1 ? '' : ' each'}`;
    }
    return `• ${p.count} ${p.label}`;
  });
  return 'TONIGHT\'S PRIZES — ALL GUARANTEED\n'
    + lines.join('\n')
    + '\n\n'
    + `${winningPacksForNight(nightId)} packs win something. Every other pack is empty.\n`
    + '\n'
    + 'HOW IT WORKS\n'
    + '• Every PAID draft you FILL earns 1 sealed pack. Free and wheel drafts earn none.\n'
    + '• Packs stay sealed all day. At 9:00 PM PT they unlock.\n'
    + '• Open one at a time, or open the whole stack at once.\n'
    + '• Gold in the tear means you hit something — but not what. The card stops face-down and waits for YOU to flip it.\n'
    + '• Anything you don\'t open simply waits for you — come back and rip it any night. You never lose what you earned.\n'
    + '\n'
    + 'YOUR ODDS\n'
    + '• The seat lands in exactly one pack out of every pack earned that day.\n'
    + '• So the more packs you hold, the bigger your share of it. Two people with one pack each are 50/50 for the seat; hold ten of the night\'s hundred and it is one in ten.\n'
    + '\n'
    + 'PROVABLY FAIR\n'
    + '• Every prize is assigned at 9:00 PM from randomness committed BEFORE the night began.\n'
    + '• Opening only reveals what was already decided — nobody, us included, can steer it.';
}

/**
 * One-line prize rundown for notifications — "1 JACKHOF SEAT, 1 JACKPOT SEAT,
 * 1 HOF SEAT + 25 free spins". Built from the night's ACTUAL pool so a one-night
 * boost (NIGHT_PRIZE_OVERRIDES) reads correctly in every ping that names it.
 */
export function prizeSummaryLine(nightId: string): string {
  const seats = nightlyPrizesFor(nightId)
    .filter((p) => p.kind !== 'spins')
    .map((p) => `${p.count} ${p.label}`);
  const spins = spinsForNight(nightId);
  return `${seats.join(', ')} + ${spins} free spins`;
}
