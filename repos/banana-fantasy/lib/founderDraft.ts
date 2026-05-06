// Founder Draft eligibility helper. Used both client-side (to render
// the FOUNDER pill on draft cards) and server-side (to validate the
// promo credit endpoint).
//
// A draft is a Founder Draft when:
//  1. The schedule is active.
//  2. The draft's start time is within ±windowMinutes of schedule.at.
//  3. The schedule's founderWallet is in the draftOrder.
//
// "Founder-anchored" means only the draft the founder actually got into
// counts — multiple drafts can fill in the same minute, but only the
// one with the founder's wallet is the Founder Draft.

export interface FounderSchedule {
  /** ISO timestamp of the next event (e.g., '2026-05-08T18:00:00-07:00'). */
  at: string;
  /** Human-readable label, e.g. "Thursday at 6 PM PT". Shown on homepage banner. */
  dayLabel: string;
  /** Founder's wallet address (lowercased). The draft must contain this wallet. */
  founderWallet: string;
  /** Window in minutes around schedule.at for drafts to count. */
  windowMinutes: number;
  /** Master switch — if false, no draft is treated as a founder draft. */
  active: boolean;
  /** ISO timestamp of last update. Optional. */
  updatedAt?: string;
}

export interface DraftOrderEntry {
  ownerId: string;
}

/** Returns true if the given draft qualifies as a Founder Draft. */
export function isFounderDraft(
  draftStartTimeUnixSec: number | null | undefined,
  draftOrder: DraftOrderEntry[] | null | undefined,
  schedule: FounderSchedule | null | undefined,
): boolean {
  if (!schedule || !schedule.active) return false;
  if (!draftStartTimeUnixSec || !draftOrder || draftOrder.length === 0) return false;

  const founder = (schedule.founderWallet || '').toLowerCase();
  if (!founder) return false;

  const draftStartMs = draftStartTimeUnixSec * 1000;
  const scheduleAtMs = Date.parse(schedule.at);
  if (!Number.isFinite(scheduleAtMs)) return false;

  const windowMs = Math.max(0, schedule.windowMinutes) * 60_000;
  if (Math.abs(draftStartMs - scheduleAtMs) > windowMs) return false;

  return draftOrder.some(o => (o?.ownerId || '').toLowerCase() === founder);
}

/** Default schedule shape returned when no doc exists yet. */
export const EMPTY_SCHEDULE: FounderSchedule = {
  at: '',
  dayLabel: '',
  founderWallet: '',
  windowMinutes: 10,
  active: false,
};
