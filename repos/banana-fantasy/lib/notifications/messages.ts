/**
 * Renders a `NotifEvent` into channel-agnostic copy (`title`, `body`, `url`).
 *
 * Copy contract (Boris 2026-06-20):
 *   • The user-facing line is a single clean string in `title` — no emoji,
 *     and it uses the LEAGUE number ("League #25"), never "BBB #25".
 *   • Email / Telegram / Discord render `title` only — no button, no link
 *     (see channels.ts). `body` exists purely so web push has `contents`
 *     and a sensible second line; it never names a "BBB"/draft brand.
 */

import type { NotifEvent, RenderedMessage } from './types';

const DEFAULT_APP_URL = 'https://banana-fantasy-sbs.vercel.app';

/** Format a pick length for copy: "8 hours" or "30 seconds". */
function timerCopy(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds >= 3600
    ? `${Math.round(seconds / 3600)} hours`
    : `${seconds} seconds`;
}

/**
 * "League #<n>" for the copy. The number comes ONLY from the draft's display
 * name ("BBB #36" → 36) — that's the true CUMULATIVE league number (fast + slow
 * combined). We deliberately DO NOT fall back to parseDraftNumber(draftId):
 * the draft id holds the per-speed SLOT number (e.g. "...slow-draft-3" → 3),
 * which is NOT the league the user is in and showed the wrong "#3" instead of
 * "#36" (Boris 2026-06-20). If the name has no number, return null so the copy
 * stays generic ("Your draft filled") rather than show a misleading number.
 */
function leagueLabel(name: string | undefined): string | null {
  const n = name?.match(/(\d+)(?!.*\d)/)?.[1];
  return n ? `League #${n}` : null;
}

/**
 * Wheel-won Jackpot/HOF specials carry the tier in their name ("Jackpot Draft …",
 * "HOF Draft …" / "Hall of Fame … (from Wheel)"). Regular drafts are "BBB #N" with
 * no tier word, so this matches ONLY the wheel specials — which get their own copy.
 */
function wheelTier(name: string | undefined): 'Jackpot' | 'HOF' | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('jackpot')) return 'Jackpot';
  if (n.includes('hall of fame') || n.includes('hof')) return 'HOF';
  return null;
}

export function renderMessage(event: NotifEvent): RenderedMessage {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  const url = `${appUrl}/draft-room?id=${event.draftId}`;
  const name = event.draftName?.trim() || '';
  // Wheel-won JP/HOF specials get their own copy (they carry the tier in the name).
  const tier = wheelTier(name);
  // "League #<cumulative>" from the display name's number; for a queue draft the
  // name is "Jackpot Draft"/"HOF Draft" (no number) so we use it verbatim.
  const subject = leagueLabel(name) ?? (name || null);

  if (event.type === 'draft.filled') {
    // Fires the moment numPlayers hits 10 (see onDraftFilled) — i.e. when the
    // draft *fills*. Wheel specials say "Jackpot/HOF Draft started — from the
    // Wheel"; regular drafts say "League #<n> filled".
    if (tier) {
      return { title: `${tier} Draft started — from the Wheel`, body: 'Tap to join your draft.', url };
    }
    return {
      title: subject ? `${subject} filled` : 'Your draft filled',
      body: 'Tap to join the draft.',
      url,
    };
  }

  // draft.your_turn — "You're on the clock — League #<n>", or the wheel-special line.
  const timer = timerCopy(event.pickLengthSeconds);
  if (tier) {
    return {
      title: `You're on the clock — ${tier} Draft (from the Wheel)`,
      body: timer ? `Tap to pick. ${timer} before it auto-drafts.` : 'Tap to pick.',
      url,
    };
  }
  return {
    title: subject ? `You're on the clock — ${subject}` : "You're on the clock",
    body: timer ? `Tap to pick. ${timer} before it auto-drafts.` : 'Tap to pick.',
    url,
  };
}
