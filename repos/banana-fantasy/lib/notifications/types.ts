/**
 * Shared types for the personal notification system.
 *
 * One dispatcher fans a draft event out to four channels (push, email,
 * Telegram, Discord). Every channel implements the same `ChannelSender`
 * signature so the dispatcher stays dumb and each sender is independently
 * testable with a mocked `fetch`.
 */

/** The two draft events we notify users about. */
export type NotifEventType = 'draft.filled' | 'draft.your_turn';

/** The four delivery channels. */
export type ChannelId = 'push' | 'email' | 'telegram' | 'discord';

/**
 * A notification event — the raw facts, before rendering into copy.
 * `pickNumber` / `pickLengthSeconds` are only set for `draft.your_turn`.
 */
export interface NotifEvent {
  type: NotifEventType;
  draftId: string;
  draftName?: string;
  /** your_turn only — drives dedup key and copy. */
  pickNumber?: number;
  /** your_turn only — drives copy and the web-push TTL. */
  pickLengthSeconds?: number;
  /**
   * your_turn only — when true this alert is for the ON-DECK player (their pick
   * is NEXT), not the one on the clock. Fast drafts fire on-deck so there's time
   * to react; copy says "your pick is next" instead of "you're on the clock".
   */
  onDeck?: boolean;
}

/** Rendered, human-facing copy for one event. */
export interface RenderedMessage {
  title: string;
  body: string;
  /** Deep link into the draft room. */
  url: string;
}

/**
 * Which events the user wants at all (independent of channel).
 * `pickSlow` / `pickFast` split the "your turn" event by draft speed, so a
 * user can, say, get pick alerts for slow drafts but not fast ones.
 * A missing/undefined key means "on" — opted out only by an explicit false.
 */
export interface EventPrefs {
  draftFilled?: boolean;
  pickSlow?: boolean;
  pickFast?: boolean;
}

/**
 * Per-user contact info + preferences.
 * Mirrors the Firestore doc `notificationPrefs/{walletAddress}`.
 */
export interface UserNotifPrefs {
  walletAddress: string;
  email?: string;
  telegramChatId?: string;
  discordId?: string;
  /** Which channels the user has switched on. Missing key === off. */
  channels: Partial<Record<ChannelId, boolean>>;
  /** Which events the user wants. Missing/undefined === on. */
  events?: EventPrefs;
  /**
   * True once the user has visited the alerts page and changed any toggle.
   * Used to hide the "Draft Alerts" prompt on the draft page after they've
   * set things up (Boris 2026-06-15).
   */
  configured?: boolean;
}

/**
 * Outcome of one channel attempt. Senders never throw — a failure or a
 * skip is returned as a value so one bad channel can't sink the others.
 */
export interface ChannelResult {
  channel: ChannelId;
  status: 'sent' | 'skipped' | 'failed';
  /** Human-readable reason when skipped or failed. */
  reason?: string;
  /** Recipient count when the provider reports it (push). */
  recipients?: number;
  /** Provider-side message id (e.g. Postmark MessageID) for log tracing. */
  providerId?: string;
}

/**
 * The signature every channel sender implements. The dispatcher calls each
 * one with the same three arguments.
 */
export type ChannelSender = (
  message: RenderedMessage,
  event: NotifEvent,
  prefs: UserNotifPrefs,
) => Promise<ChannelResult>;

/**
 * Result of an atomic dedup claim:
 * - `claimed`  — first caller; proceed to send.
 * - `deduped`  — already sent (or in flight); do nothing.
 * - `retry`    — a prior attempt failed; the slot was reopened, proceed.
 */
export type ClaimResult = 'claimed' | 'deduped' | 'retry';
