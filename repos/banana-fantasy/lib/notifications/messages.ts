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
    return {
      title: '🍌 Your draft is starting!',
      body: name
        ? `${name} just filled — all 10 spots are in. Tap to join the draft.`
        : 'Your draft just filled — all 10 spots are in. Tap to join.',
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
