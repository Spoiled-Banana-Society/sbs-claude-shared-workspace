/**
 * Active private-league session (ticket-2681 AceJohn incident, 2026-08-14).
 *
 * Problem this solves: a KFFL/KoD member unlocks their league page with the
 * password, then clicks the site's normal "Enter Draft" button (home,
 * buy-drafts, post-purchase prompt) expecting it to be their group's draft —
 * and lands in the PUBLIC matchmaker instead. Zero private joins ever reached
 * the backend in the feature's first 4 days live because of exactly this.
 *
 * Fix: the moment a password is ACCEPTED on /private/[id], we remember that
 * league here. useEnterDraft then routes ANY join without an explicit target
 * into the member's private league (their expectation), and EntryFlowModal
 * shows a banner naming the league with an explicit "join a public SBS draft
 * instead" escape hatch for members who also play public drafts.
 *
 * The password itself is NOT duplicated — it stays under the private page's
 * own `sbs-private-pw:{id}` key (the page clears it on a 403, e.g. after a
 * commissioner rotates the password, and this session dies with it).
 */

const ACTIVE_KEY = 'sbs-private-league-active';
const pwStorageKey = (id: string) => `sbs-private-pw:${id}`;

export interface ActivePrivateLeague {
  id: string;
  /** Display name from the league config ("KFFL") — for the modal banner. */
  name: string;
  /** The league's fixed lane — a private join always drafts at this speed. */
  draftType: 'fast' | 'slow';
}

export interface ActivePrivateLeagueWithPassword extends ActivePrivateLeague {
  password: string;
}

export function setActivePrivateLeague(league: ActivePrivateLeague): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(league));
  } catch { /* private browsing — feature degrades to the old behavior */ }
}

/**
 * The league joins should default into, or null. Requires BOTH the pointer and
 * the accepted password to still be present — if the private page dropped the
 * password (403 after a rotation), this returns null and joins go public again.
 */
export function getActivePrivateLeague(): ActivePrivateLeagueWithPassword | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePrivateLeague>;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
    const password = localStorage.getItem(pwStorageKey(parsed.id)) ?? '';
    if (!password) return null;
    return {
      id: parsed.id,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Private league',
      draftType: parsed.draftType === 'slow' ? 'slow' : 'fast',
      password,
    };
  } catch {
    return null;
  }
}

/** Drop the routing pointer; optionally also forget the accepted password. */
export function clearActivePrivateLeague(opts?: { alsoPassword?: boolean }): void {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    if (opts?.alsoPassword && raw) {
      const parsed = JSON.parse(raw) as Partial<ActivePrivateLeague>;
      if (parsed && typeof parsed.id === 'string' && parsed.id) {
        localStorage.removeItem(pwStorageKey(parsed.id));
      }
    }
  } catch { /* ignore */ }
}
