// Admin drafting block — client-safe half (no firebase-admin here).
//
// v2_users.draftBlocked = true means: the account keeps working (login,
// teams, winnings, marketplace, promos view) but NO draft entry anywhere on
// the site — public fast/slow lobbies, private leagues, special (JP/HOF/
// JackHOF), founder and ATB lobbies. Softer than `banned` (which 403s the
// whole API). Boris 2026-08-18, first target Wp34.
//
// Client gate: useAuth mirrors the flag from the balance payload/stream into
// a module flag; lib/api/leagues joinDraft/joinPrivateDraft assert it before
// touching the Go join, and useEnterDraft short-circuits before the overlay.
// Server gate: lib/draftBlockServer.assertWalletCanDraft on our own join
// routes (special-draft / founder). The public Go join itself is Richard's —
// the client gate is what stops it from the site.

export const DRAFT_BLOCKED_MESSAGE =
  'Drafting is disabled on this account. You can still view your teams. Contact support if you think this is a mistake.';

let clientDraftBlocked = false;

export function setClientDraftBlocked(v: boolean): void {
  clientDraftBlocked = v === true;
}

export function isClientDraftBlocked(): boolean {
  return clientDraftBlocked;
}

/** Throws (with the user-facing message) when the signed-in account is draft-blocked. */
export function assertClientCanDraft(): void {
  if (clientDraftBlocked) throw new Error(DRAFT_BLOCKED_MESSAGE);
}
