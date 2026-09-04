/**
 * Regular slow drafts closed to new entries (Richard 2026-09-03).
 *
 * The site never picks a lobby — it asks the Go matchmaker to "join slow" and
 * Go seats you in the lowest open regular slow lobby, spawning the next one
 * when it fills. So "let the last 8/10 lobby fill, then stop" can only be
 * enforced here, at the click: ONE no-store read of /api/drafts/next-lobby
 * (server-filtered to the single lobby still allowed) right before the join.
 * Not a hook, not an effect — rule #0 safe. Fails CLOSED (network error →
 * blocked) because a wrong "allowed" burns a pass in a lobby that never fills.
 */

export const REGULAR_SLOW_CLOSED_MESSAGE =
  'Regular slow drafts are closed to new entries. Slow drafts now run only in special leagues like Jackpot, JackHOF and HOF.';

interface NextLobbyBody {
  slow?: Array<{ id: string; seats: number; maxSeats: number }>;
  regularSlowClosed?: boolean;
}

/** True while a public "join slow" would land in a lobby that is still allowed to fill. */
export async function regularSlowJoinAllowed(): Promise<boolean> {
  try {
    const res = await fetch('/api/drafts/next-lobby', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as NextLobbyBody;
    if (body.regularSlowClosed !== true) return true;
    return (body.slow ?? []).some((l) => l.seats < l.maxSeats);
  } catch {
    return false;
  }
}
