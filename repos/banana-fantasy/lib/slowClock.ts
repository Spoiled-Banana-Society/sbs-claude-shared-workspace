/**
 * Slow-draft clock switch — system_config/slowDraftClock.
 *
 * SHIPS DARK. Until `enabled` is true every surface renders the legacy copy
 * ("8 hours per pick", carry-over after the overnight pause) byte-for-byte.
 * The green light is one Firestore field flip (scripts/_slow-clock-toggle.mjs);
 * matching Underdog later (4h → 2h → 1h …) is a `pickLengthSec` change in the
 * same doc — no deploy on either side. The Go API reads the same doc
 * (models/slow_draft_clock_config.go) and re-derives the clock on EVERY pick
 * advance, so drafts already in progress pick it up on their next pick.
 *
 * This file is isomorphic (no firebase import). Server read lives in
 * lib/slowClockServer.ts; client access is `useSlowClock()` from
 * contexts/SlowClockContext.
 */

export interface SlowClockConfig {
  enabled: boolean;
  /** Pick clock in seconds while enabled. */
  pickLengthSec: number;
  /** A pick that straddles 22:00 PT restarts with a FULL clock when the pause ends. */
  freshClockAfterPause: boolean;
  /** PT hour the overnight pause ends (legacy 5; Richard 8/26: 7). */
  pauseEndHour: number;
  /**
   * Regular (BBB #N) slow drafts closed to new entries (Richard 2026-09-03):
   * slow drafts live on only in special leagues (Jackpot / JackHOF / HOF) and
   * password-gated private leagues. Independent of `enabled` / `startsAtIso`.
   */
  regularJoinClosed: boolean;
  /**
   * The one regular slow lobby still allowed to fill after the close
   * (`2026-slow-draft-168`, 8/10 when closed). Once it's full nothing
   * regular-slow is joinable. '' = none.
   */
  regularJoinLastLobbyId: string;
}

export const LEGACY_SLOW_PICK_SEC = 8 * 3600;
export const LEGACY_PAUSE_END_HOUR = 5;
export const PAUSE_START_HOUR = 22;

/** Switch-off state: exactly what the site did before this shipped. */
export const LEGACY_SLOW_CLOCK: SlowClockConfig = {
  enabled: false,
  pickLengthSec: LEGACY_SLOW_PICK_SEC,
  freshClockAfterPause: false,
  pauseEndHour: LEGACY_PAUSE_END_HOUR,
  regularJoinClosed: false,
  regularJoinLastLobbyId: '',
};

/** Every phrasing of the pick clock the UI uses, so copy lives in ONE place. */
export interface SlowClockCopy {
  /** Seconds actually in force (legacy 28800 when off). */
  pickLengthSec: number;
  /** "8 hours" / "4 hours" / "90 minutes" */
  long: string;
  /** "8 hours per pick" */
  perPick: string;
  /** "8hr" (badge) */
  short: string;
  /** "8h" (compact badge / "8h per pick") */
  compact: string;
  /** "8 hrs/pick" */
  hrsPick: string;
  /** "8 hour" (row: "8 hour") */
  word: string;
  /** "8-hour" (bells: "8-hour picks") */
  hyphen: string;
  /** Sentence appended to FAQ answers while the switch is on; '' when off. */
  shorteningNote: string;
  /** Sentence for the pause rule; only differs when the fresh clock is on. */
  pauseNote: string;
  /** "5am" / "7am" */
  pauseEndLabel: string;
  /** "10pm–5am PT" (en dash) */
  pauseWindowLabel: string;
  pauseEndHour: number;
  enabled: boolean;
  freshClockAfterPause: boolean;
}

/**
 * `startsAtIso` (optional RFC3339): while set and in the future the switch
 * reads as OFF even if `enabled` — arm it today for "5am PT tomorrow" with
 * nothing having to wake up and flip it. Mirrors `active()` in Go.
 */
export function normalizeSlowClockConfig(raw: unknown, nowMs: number = Date.now()): SlowClockConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let enabled = r.enabled === true;
  if (enabled && typeof r.startsAtIso === 'string' && r.startsAtIso) {
    const t = Date.parse(r.startsAtIso);
    if (Number.isFinite(t) && nowMs < t) enabled = false;
  }
  const sec = typeof r.pickLengthSec === 'number' && Number.isFinite(r.pickLengthSec) && r.pickLengthSec > 0
    ? Math.floor(r.pickLengthSec)
    : LEGACY_SLOW_PICK_SEC;
  const peh = typeof r.pauseEndHour === 'number' && Number.isInteger(r.pauseEndHour) && r.pauseEndHour > 0 && r.pauseEndHour < PAUSE_START_HOUR
    ? r.pauseEndHour
    : LEGACY_PAUSE_END_HOUR;
  return {
    enabled,
    pickLengthSec: enabled ? sec : LEGACY_SLOW_PICK_SEC,
    freshClockAfterPause: enabled && r.freshClockAfterPause === true,
    pauseEndHour: enabled ? peh : LEGACY_PAUSE_END_HOUR,
    regularJoinClosed: r.regularJoinClosed === true,
    regularJoinLastLobbyId: typeof r.regularJoinLastLobbyId === 'string' ? r.regularJoinLastLobbyId.trim() : '',
  };
}

/**
 * May a REGULAR slow lobby (`yyyy-slow-draft-N`) still take a public join?
 * Specials and private leagues never go through this — they have their own
 * seating paths (lib/specialDraft.ts, joinPrivateDraft).
 */
export function isRegularSlowLobbyJoinable(cfg: SlowClockConfig, lobbyId: string): boolean {
  if (!cfg.regularJoinClosed) return true;
  return !!cfg.regularJoinLastLobbyId && lobbyId === cfg.regularJoinLastLobbyId;
}

function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'am' : 'pm'}`;
}

export function slowClockCopy(cfg: SlowClockConfig = LEGACY_SLOW_CLOCK): SlowClockCopy {
  const sec = cfg.enabled ? cfg.pickLengthSec : LEGACY_SLOW_PICK_SEC;
  const pauseEndHour = cfg.enabled ? cfg.pauseEndHour : LEGACY_PAUSE_END_HOUR;
  const pauseEndLabel = hourLabel(pauseEndHour);
  const wholeHours = sec % 3600 === 0 ? sec / 3600 : null;
  let long: string, short: string, compact: string, hrsPick: string, word: string, hyphen: string;
  if (wholeHours !== null) {
    const h = wholeHours;
    long = `${h} hour${h === 1 ? '' : 's'}`;
    short = `${h}hr`;
    compact = `${h}h`;
    hrsPick = `${h} hr${h === 1 ? '' : 's'}/pick`;
    word = `${h} hour`;
    hyphen = `${h}-hour`;
  } else {
    const m = Math.max(1, Math.round(sec / 60));
    long = `${m} minute${m === 1 ? '' : 's'}`;
    short = `${m}min`;
    compact = `${m}m`;
    hrsPick = `${m} min/pick`;
    word = `${m} minute`;
    hyphen = `${m}-minute`;
  }
  return {
    pickLengthSec: sec,
    long,
    perPick: `${long} per pick`,
    short,
    compact,
    hrsPick,
    word,
    hyphen,
    shorteningNote: cfg.enabled
      ? ' Clocks get shorter as kickoff gets closer so every draft finishes in time.'
      : '',
    pauseNote: cfg.enabled && cfg.freshClockAfterPause
      ? `If you were on the clock when the overnight pause hit, you get a fresh full clock at ${pauseEndLabel} PT.`
      : '',
    pauseEndLabel,
    pauseWindowLabel: `${hourLabel(PAUSE_START_HOUR)}–${pauseEndLabel} PT`,
    pauseEndHour,
    enabled: cfg.enabled,
    freshClockAfterPause: cfg.enabled && cfg.freshClockAfterPause,
  };
}

export const LEGACY_SLOW_CLOCK_COPY: SlowClockCopy = slowClockCopy(LEGACY_SLOW_CLOCK);
