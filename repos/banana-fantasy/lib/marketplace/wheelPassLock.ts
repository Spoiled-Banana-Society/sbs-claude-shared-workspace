import { getQueueStatus, isSpecialDraftStarted } from '@/lib/db';

/**
 * Shared "is this wheel-won pass still sellable?" check.
 *
 * A wheel-won JP/HOF pass is only sellable while its special draft round is
 * still FILLING. Once the round starts (or fills to 10) the pass is locked to
 * whoever owned it at fill time. This is purely state-based (no clocks), with
 * the queue as the source of truth.
 *
 * Both buy paths must enforce this: the embedded-wallet fulfill route AND the
 * external-wallet relay-buy route. Previously only fulfill checked it, so an
 * external wallet could buy a locked pass — this helper closes that gap.
 *
 * Returns:
 *  - { locked: true, ... }  → the pass is locked; block the sale (409).
 *  - { locked: false, ... } → it's a wheel pass in an open filling round; allow.
 *  - null                   → not in any special queue (regular team/pass, or
 *                              queue data unavailable) → caller should allow.
 */

/** Canonical decimal token id (strips leading zeros) for queue comparisons. */
function canonId(id: string): string {
  try { return BigInt(id).toString(); } catch { return id; }
}

type QueueRound = { status?: string; draftId?: string; members?: Array<{ tokenId?: string; wallet?: string }> };
type Queues = Partial<Record<'jackpot' | 'hof', { rounds?: QueueRound[] }>>;

export interface WheelPassLockResult {
  locked: boolean;
  wallet: string;
  tokenId: string;
}

export async function checkWheelPassLock(tokenId: string | null | undefined): Promise<WheelPassLockResult | null> {
  if (!tokenId) return null;
  const ident = canonId(String(tokenId));
  const queues = (await getQueueStatus().catch(() => null)) as Queues | null;
  if (!queues) return null;
  for (const type of ['jackpot', 'hof'] as const) {
    for (const round of queues[type]?.rounds || []) {
      const member = (round.members || []).find(m => m.tokenId && canonId(String(m.tokenId)) === ident);
      if (!member) continue;
      let locked = round.status !== 'filling' || (round.members || []).length >= 10;
      // The queue `status`/count can lag the real draft (e.g. staging fill-bots
      // seat the Go league directly). If the Go draft has actually STARTED, the
      // pass is locked regardless of what the queue says.
      if (!locked && round.draftId && (await isSpecialDraftStarted(round.draftId))) {
        locked = true;
      }
      return { locked, wallet: member.wallet ?? '', tokenId: String(member.tokenId) };
    }
  }
  return null;
}
