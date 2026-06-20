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
import { parseDraftNumber } from '@/lib/batchProof';

const DEFAULT_APP_URL = 'https://banana-fantasy-sbs.vercel.app';

/** Format a pick length for copy: "8 hours" or "30 seconds". */
function timerCopy(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds >= 3600
    ? `${Math.round(seconds / 3600)} hours`
    : `${seconds} seconds`;
}

/**
 * "League #<n>" for the copy. Prefers the number the user already sees in the
 * draft's display name (e.g. "BBB #25" → 25), falling back to the global
 * league number parsed from the draft id. Returns null if neither yields one.
 */
function leagueLabel(name: string | undefined, draftId: string): string | null {
  const lastNumInName = name?.match(/(\d+)(?!.*\d)/)?.[1];
  const parsed = parseDraftNumber(draftId);
  const n = lastNumInName ?? (parsed != null ? String(parsed) : undefined);
  return n ? `League #${n}` : null;
}

export function renderMessage(event: NotifEvent): RenderedMessage {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  const url = `${appUrl}/draft-room?id=${event.draftId}`;
  const name = event.draftName?.trim() || '';
  const label = leagueLabel(name, event.draftId);

  if (event.type === 'draft.filled') {
    // Fires the moment numPlayers hits 10 (see onDraftFilled in
    // ~/sbs-staging-functions/functions/index.js) — i.e. when the draft
    // *fills*. The visible line is just "League #<n> filled".
    return {
      title: label ? `${label} filled` : 'Your draft filled',
      body: 'Tap to join the draft.',
      url,
    };
  }

  // draft.your_turn — visible line is just "You're on the clock — League #<n>".
  const timer = timerCopy(event.pickLengthSeconds);
  return {
    title: label ? `You're on the clock — ${label}` : "You're on the clock",
    body: timer ? `Tap to pick. ${timer} before it auto-drafts.` : 'Tap to pick.',
    url,
  };
}
