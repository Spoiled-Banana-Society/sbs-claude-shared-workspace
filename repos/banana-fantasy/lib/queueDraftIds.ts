import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

let cache: { ids: Set<string>; at: number } | null = null;
const TTL_MS = 60_000;

/**
 * Draft ids belonging to special-queue rounds (jackpot / hof / jackhof).
 *
 * Queue drafts are deliberately created under prior-season ids ('2025-…') so
 * they never disturb the 2026 lane numbering — which means "prior-season id"
 * does NOT imply "dead draft". Any code that short-circuits old-season ids
 * MUST exempt these. (Regression 2026-09-02: the zombie short-circuit made
 * the JACKHOF queue room render as a full 10/10 generic lobby — Isaic's
 * report — because league-players answered "numPlayers 10, players []" for
 * its 2025-numbered id.)
 *
 * One 3-doc read per instance per minute; fails OPEN (treat as queue draft →
 * normal, non-short-circuited path) so an outage can never re-break rooms.
 */
export async function getQueueDraftIds(): Promise<Set<string> | null> {
  if (!isFirestoreConfigured()) return null;
  const now = Date.now();
  if (!cache || now - cache.at > TTL_MS) {
    try {
      const db = getAdminFirestore();
      const snaps = await db.getAll(
        db.collection('v2_queues').doc('jackpot'),
        db.collection('v2_queues').doc('hof'),
        db.collection('v2_queues').doc('jackhof'),
      );
      const ids = new Set<string>();
      for (const s of snaps) {
        const rounds = (s.data()?.rounds ?? []) as Array<{ draftId?: string }>;
        for (const r of rounds) if (r.draftId) ids.add(r.draftId);
      }
      cache = { ids, at: now };
    } catch {
      return null; // caller must fail OPEN (treat unknown ids as live)
    }
  }
  return cache.ids;
}

export async function isQueueDraftId(draftId: string): Promise<boolean> {
  const ids = await getQueueDraftIds();
  if (!ids) return true; // can't confirm → take the normal path, never the short-circuit
  return ids.has(draftId);
}
