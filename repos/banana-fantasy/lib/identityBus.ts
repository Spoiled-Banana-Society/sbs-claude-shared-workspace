'use client';

/**
 * Pure client-side pub/sub for "a user just edited their identity (name/pfp)".
 *
 * Purpose: make the editor's OWN other on-screen surfaces (e.g. their draft-room
 * card, which reads /api/users/display-batch, not useAuth) update INSTANTLY when
 * they save — without a server round-trip or websocket. It only fires on the
 * same client that made the edit.
 *
 * Cross-client propagation (OTHER people seeing the change) is intentionally NOT
 * this bus's job — that's handled by the 30s `refreshInterval` + focus
 * revalidation on the identity hooks (useDraftRoomUsers). No backend involved.
 */

type Listener = (wallet: string) => void;

const listeners = new Set<Listener>();

/** Call after a successful name/pfp save with the editor's wallet. */
export function publishIdentityChange(wallet: string | undefined | null): void {
  const w = (wallet || '').toLowerCase();
  if (!w) return;
  for (const l of listeners) {
    try { l(w); } catch { /* a bad listener must not break the others */ }
  }
}

/** Subscribe to identity edits made on this client. Returns an unsubscribe fn. */
export function subscribeIdentityChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
