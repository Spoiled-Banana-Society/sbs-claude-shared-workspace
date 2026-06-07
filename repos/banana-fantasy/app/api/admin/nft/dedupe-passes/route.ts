import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { recountFromInventory } from '@/lib/passLedger';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Pass-ledger duplicate cleanup.
 *
 * The pre-fix Go registration could write TWO `validDraftTokens` records for ONE
 * on-chain token (a recycled id registered by both the mint path and the Alchemy
 * webhook). Those phantom rows inflate the pass counter. This finds groups of
 * (owner, realTokenId) with >1 record and — in execute mode — keeps exactly one
 * and removes the extras, then recounts the owner.
 *
 * SAFETY:
 *   - It ONLY ever touches records that share an on-chain `RealTokenId` with
 *     another record OWNED BY THE SAME WALLET. Previous-season teams/leagues are
 *     single records (no same-owner twin) and are NEVER matched or deleted.
 *   - Keep priority: a DRAFTED record (has a LeagueId/roster) always wins over an
 *     undrafted pass, so a real team is never the one removed.
 *   - Defaults to mode=report (read-only). mode=execute requires it explicitly.
 *
 * Auth: admin Privy session OR x-admin-key (ADMIN_API_KEY / bootstrap secret).
 */
async function authed(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-admin-key') || '';
  const adminKey = process.env.ADMIN_API_KEY || '';
  const bootstrap = process.env.NFT_REFRESH_SECRET || '';
  if ((adminKey && provided === adminKey) || (bootstrap && provided === bootstrap)) return true;
  try { await requireAdmin(req); return true; } catch { return false; }
}

interface Rec { owner: string; cardId: string; realTokenId: string; leagueId: string; drafted: boolean; ref: FirebaseFirestore.DocumentReference }

function isDrafted(data: Record<string, unknown>): boolean {
  if (String(data.LeagueId ?? data.leagueId ?? '').trim() !== '') return true;
  const roster = (data.Roster ?? data.roster) as Record<string, unknown[] | null> | undefined;
  if (roster) for (const arr of Object.values(roster)) if (Array.isArray(arr) && arr.length > 0) return true;
  return false;
}

export async function POST(req: Request) {
  if (!(await authed(req))) return jsonError('Unauthorized', 401);
  const mode = (getSearchParam(req, 'mode') || 'report').toLowerCase();
  const ownerFilter = (getSearchParam(req, 'owner') || '').toLowerCase();
  const db = getAdminFirestore();

  // Pull every spendable-token record (optionally a single owner). Group by
  // (owner, realTokenId); only non-empty realTokenIds can collide (those are
  // the collision-branch records).
  const groups = new Map<string, Rec[]>();
  let scanned = 0;
  try {
    const snap = ownerFilter
      ? await db.collection(`owners/${ownerFilter}/validDraftTokens`).get()
      : await db.collectionGroup('validDraftTokens').get();
    snap.forEach((doc) => {
      scanned += 1;
      const d = doc.data() as Record<string, unknown>;
      const owner = String(d.OwnerId ?? d.ownerId ?? doc.ref.parent.parent?.id ?? '').toLowerCase();
      const realTokenId = String(d.RealTokenId ?? d.realTokenId ?? '').trim();
      if (!owner || !/^\d+$/.test(realTokenId)) return; // only real-id collision-branch rows can dup
      const key = `${owner}::${realTokenId}`;
      const rec: Rec = {
        owner,
        cardId: String(d.CardId ?? d.cardId ?? doc.id),
        realTokenId,
        leagueId: String(d.LeagueId ?? d.leagueId ?? ''),
        drafted: isDrafted(d),
        ref: doc.ref,
      };
      const arr = groups.get(key) ?? [];
      arr.push(rec);
      groups.set(key, arr);
    });
  } catch (err) {
    logger.error('admin.dedupe_passes.scan_failed', { err: String(err) });
    return jsonError(`scan failed: ${String(err)}`, 500);
  }

  // Build the duplicate plan: keep one per group (drafted wins, else lowest cardId).
  const dupGroups: Array<{ owner: string; realTokenId: string; keep: string; remove: string[] }> = [];
  const affectedOwners = new Set<string>();
  const toDelete: Rec[] = [];
  for (const [, recs] of groups) {
    if (recs.length < 2) continue;
    const sorted = [...recs].sort((a, b) => {
      if (a.drafted !== b.drafted) return a.drafted ? -1 : 1; // drafted first
      return a.cardId.localeCompare(b.cardId); // deterministic
    });
    const keep = sorted[0];
    const remove = sorted.slice(1);
    dupGroups.push({ owner: keep.owner, realTokenId: keep.realTokenId, keep: keep.cardId, remove: remove.map((r) => r.cardId) });
    affectedOwners.add(keep.owner);
    toDelete.push(...remove);
  }

  const perOwner: Record<string, number> = {};
  for (const g of dupGroups) perOwner[g.owner] = (perOwner[g.owner] ?? 0) + g.remove.length;

  const summary = {
    scanned,
    duplicateGroups: dupGroups.length,
    recordsToRemove: toDelete.length,
    affectedWallets: affectedOwners.size,
    perWallet: perOwner,
  };

  if (mode !== 'execute') {
    return json({ mode: 'report', summary, groups: dupGroups.slice(0, 500) });
  }

  // EXECUTE: delete the extra spendable rows (+ their global draftToken &
  // metadata docs keyed by the phantom synthetic cardId), then recount owners.
  let deleted = 0;
  for (const rec of toDelete) {
    try {
      await rec.ref.delete();
      // The phantom's global draftTokens doc + metadata doc are keyed by its
      // (synthetic) cardId. Remove them too so nothing dangles. Best-effort.
      await db.collection('draftTokens').doc(rec.cardId).delete().catch(() => {});
      await db.collection('draftTokenMetadata').doc(rec.cardId).delete().catch(() => {});
      deleted += 1;
    } catch (err) {
      logger.warn('admin.dedupe_passes.delete_failed', { owner: rec.owner, cardId: rec.cardId, err: String(err) });
    }
  }

  const recounts: Record<string, { draftPasses: number; freeDrafts: number }> = {};
  for (const owner of affectedOwners) {
    try { recounts[owner] = await recountFromInventory(owner); }
    catch (err) { logger.warn('admin.dedupe_passes.recount_failed', { owner, err: String(err) }); }
  }

  logger.info('admin.dedupe_passes.executed', { ...summary, deleted });
  return json({ mode: 'execute', summary, deleted, recounts });
}
