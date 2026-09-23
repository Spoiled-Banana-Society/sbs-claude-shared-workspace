/**
 * GET /api/crons/holders-sweep — nightly: who holds each BBB4 card on-chain vs who the engine credits (the drafter).
 *
 * Boris 2026-09-22: teams bought on OpenSea (or transferred wallet-to-wallet) never touch our marketplace log, so the
 * leaderboard / league popup kept showing the drafter. One Alchemy owners call for the whole collection (~14k tokens,
 * one page), one select() read over draftTokens, then only the MISMATCHES are written to `token_holders/{tokenId}`
 * (~150 docs). Display readers merge that collection in (lib/marketplace/holders.ts). Scoring / prizes untouched —
 * prizes already pay the on-chain owner. Cost ≈ 14k Firestore reads/night ≈ $0.01.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { BASE_RPC_URL, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function onchainHolders(): Promise<Map<string, string>> {
  const key = BASE_RPC_URL.match(/alchemy\.com\/v2\/([A-Za-z0-9_-]+)/)?.[1];
  if (!key) throw new Error('BASE_RPC_URL is not an Alchemy URL; cannot list collection owners');
  const base = new URL(BASE_RPC_URL).origin;
  const out = new Map<string, string>();
  let pageKey = '';
  for (let page = 0; page < 50; page++) {
    const u = `${base}/nft/v3/${key}/getOwnersForContract?contractAddress=${BBB4_CONTRACT_ADDRESS}&withTokenBalances=true${pageKey ? `&pageKey=${encodeURIComponent(pageKey)}` : ''}`;
    const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`Alchemy getOwnersForContract HTTP ${r.status}`);
    const j = (await r.json()) as { owners?: Array<{ ownerAddress?: string; tokenBalances?: Array<{ tokenId?: string; balance?: string }> }>; pageKey?: string };
    for (const o of j.owners ?? []) {
      const w = String(o.ownerAddress ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(w)) continue;
      for (const tb of o.tokenBalances ?? []) {
        const raw = String(tb.tokenId ?? '');
        const id = raw.startsWith('0x') ? BigInt(raw).toString() : raw;
        if (/^\d+$/.test(id) && Number(tb.balance ?? '1') > 0) out.set(id, w);
      }
    }
    pageKey = j.pageKey ?? '';
    if (!pageKey) break;
  }
  return out;
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const isCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    try { await requireAdmin(req); } catch { return jsonError('Unauthorized', 401); }
  }
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  const dryRun = getSearchParam(req, 'dry') === '1';
  const db = getAdminFirestore();
  try {
    const holders = await onchainHolders();
    if (holders.size < 1000) throw new Error(`owners list suspiciously small (${holders.size}); not touching token_holders`);

    // Engine credit (drafter) per numeric token.
    const drafter = new Map<string, string>();
    const toks = await db.collection('draftTokens').select('OwnerId').get();
    for (const d of toks.docs) if (/^\d+$/.test(d.id)) drafter.set(d.id, String((d.data() as { OwnerId?: unknown }).OwnerId ?? '').toLowerCase());

    // Mismatches = holder ≠ drafter (and we know both).
    const mismatches = new Map<string, { holder: string; drafter: string }>();
    for (const [id, dr] of drafter) { const h = holders.get(id); if (h && dr && h !== dr) mismatches.set(id, { holder: h, drafter: dr }); }

    // Reconcile the small overlay collection: upsert changed, delete healed.
    const existing = await db.collection('token_holders').get();
    let upserts = 0, deletes = 0;
    let batch = db.batch(); let n = 0;
    const flush = async () => { if (n) { if (!dryRun) await batch.commit(); batch = db.batch(); n = 0; } };
    for (const d of existing.docs) {
      const m = mismatches.get(d.id);
      if (!m) { batch.delete(d.ref); deletes++; n++; }
      else if ((d.data() as { holder?: string }).holder !== m.holder) { batch.set(d.ref, { ...m, updatedAt: FieldValue.serverTimestamp(), source: 'sweep' }); upserts++; n++; }
      if (n >= 400) await flush();
    }
    const known = new Set(existing.docs.map((d) => d.id));
    for (const [id, m] of mismatches) {
      if (known.has(id)) continue;
      batch.set(db.collection('token_holders').doc(id), { ...m, updatedAt: FieldValue.serverTimestamp(), source: 'sweep' }); upserts++; n++;
      if (n >= 400) await flush();
    }
    await flush();

    const summary = { status: 'ok', dryRun, onchainTokens: holders.size, engineTokens: drafter.size, mismatches: mismatches.size, upserts, deletes };
    if (!dryRun) await recordCronHeartbeat('holders-sweep', summary);
    logger.info('holders_sweep.done', summary);
    return json(summary);
  } catch (err) {
    logger.error('holders_sweep.failed', { err: String(err) });
    return jsonError(`Holders sweep failed: ${(err as Error).message}`, 500);
  }
}
