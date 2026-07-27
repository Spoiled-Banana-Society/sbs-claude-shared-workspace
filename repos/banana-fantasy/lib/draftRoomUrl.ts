import type { DraftState } from '@/lib/draftStore';

/**
 * Canonical draft-room URL for a draft the user is in — extracted from
 * useDraftingPageState so other surfaces (e.g. the live-activity line) can
 * deep-link into a room with exactly the params the room expects.
 */
export function buildDraftRoomUrl(
  draft: DraftState,
  opts: { live: boolean; wallet?: string | null },
): string {
  // Don't pass a numbered name for filling drafts — batch number only assigned after start
  const isFilling = draft.status === 'filling' || (draft.players || 0) < 10;
  const params = new URLSearchParams({
    id: draft.queueDraftId || draft.id,
    name: isFilling ? 'Draft Room' : draft.contestName,
    speed: draft.draftSpeed,
    players: String(draft.players),
  });
  if (opts.live && opts.wallet) {
    params.set('mode', 'live');
    params.set('wallet', opts.wallet);
  }
  if (draft.passType) params.set('passType', draft.passType);
  const st = draft.specialType || ((draft.type === 'jackpot' || draft.type === 'hof' || draft.type === 'jackhof') && draft.draftSpeed === 'slow' ? draft.type : undefined);
  if (st) params.set('specialType', st);
  return `/draft-room?${params.toString()}`;
}
