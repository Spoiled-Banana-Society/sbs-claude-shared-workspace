import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { RosterFetcher } from '@/lib/kingWeek';

/**
 * King tie-breaker data source (Boris 2026-06-27): reads draft docs'
 * `CurrentUsers` array — which the Go API appends in join order — and returns
 * draftId → (wallet → seat index, 0 = joined the lobby first). READ-ONLY; never
 * writes or touches the Go backend. Called only when a King tie actually needs
 * resolving, so it adds zero reads on the common path.
 */
export const fetchDraftRosters: RosterFetcher = async (draftIds) => {
  const map = new Map<string, Map<string, number>>();
  const ids = draftIds.filter(Boolean);
  if (ids.length === 0) return map;
  const db = getAdminFirestore();
  const snaps = await db.getAll(...ids.map((id) => db.collection('drafts').doc(id)));
  for (const snap of snaps) {
    const cu = (snap.data()?.CurrentUsers as Array<{ OwnerId?: string }> | undefined);
    if (!Array.isArray(cu)) continue;
    const seats = new Map<string, number>();
    cu.forEach((u, i) => {
      const w = (u?.OwnerId || '').toLowerCase();
      if (w && !seats.has(w)) seats.set(w, i);
    });
    map.set(snap.id, seats);
  }
  return map;
};
