import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { parseDraftNumber } from '@/lib/batchProof';

/**
 * Resolve a draftId to its GLOBAL league number — the number the VRF / Merkle
 * fairness distribution is committed against (the draft's `DisplayName`,
 * "BBB #N", = `FilledLeaguesCount` at fill, counting fast AND slow drafts).
 *
 * The slot-id trailing number (`parseDraftNumber`) is a PER-SPEED counter
 * (`{year}-fast-draft-N` / `slow-draft-N`) that drifts from the global number
 * once slow drafts run or ids are reused across eras — so it's only a
 * last-resort fallback. For a bare-number / `league-N` id the fallback is
 * already the global number, so this is safe there too (no `drafts/{id}` doc).
 *
 * IMPORTANT: this resolver is for the PROOF surface only. A draft's actual
 * type/prizes are assigned backend-side off the global number and are correct
 * regardless of this — see project_league_numbering_model.
 */
export async function resolveGlobalLeagueNumber(draftId: string): Promise<number | null> {
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('drafts').doc(draftId).get();
      const dn = String((snap.data() as { DisplayName?: string } | undefined)?.DisplayName ?? '').trim();
      // Only override for the normal batch-distributed "BBB #N" name. Special
      // wheel drafts ("Jackpot #N (from Wheel)") and missing names fall back
      // to the slot parse, preserving their current behavior.
      const m = /^BBB\s*#(\d+)$/i.exec(dn);
      if (m) return Number(m[1]);
    } catch {
      /* fall through to slot parse */
    }
  }
  return parseDraftNumber(draftId);
}
