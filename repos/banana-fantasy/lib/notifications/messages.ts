/**
 * Renders a `NotifEvent` into channel-agnostic copy (`title`, `body`, `url`).
 * The "your turn" timer copy is ported from the original pick-up route so
 * push users see identical wording.
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

export function renderMessage(event: NotifEvent): RenderedMessage {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  const url = `${appUrl}/draft-room?id=${event.draftId}`;
  const name = event.draftName?.trim() || '';

  if (event.type === 'draft.filled') {
    // Fires the moment numPlayers hits 10 (see onDraftFilled in
    // ~/sbs-staging-functions/functions/index.js) — i.e. when the draft
    // *fills*, before the countdown + first pick. Copy reflects that.
    // `url` deep-links into the specific draft room so tapping the
    // notification takes the user straight to their draft.
    return {
      title: name ? `🍌 ${name} filled` : '🍌 Your draft filled',
      body: 'Tap to join the draft.',
      url,
    };
  }

  // draft.your_turn
  const timer = timerCopy(event.pickLengthSeconds);
  return {
    title: "🍌 You're on the clock!",
    body: name
      ? timer
        ? `${name} — tap to pick. ${timer} before it auto-drafts.`
        : `${name} — tap to pick.`
      : timer
        ? `Your pick is up. ${timer} before it auto-drafts.`
        : 'Your pick is up — tap to pick.',
    url,
  };
}
