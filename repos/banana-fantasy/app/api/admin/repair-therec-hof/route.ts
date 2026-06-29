export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * ONE-OFF repair endpoint (2026-06-28): re-mints Therec's HOF wheel pass after
 * his original HOF pass (#408) was wrongly consumed by League 29 (the
 * selectTokensByType bug, now fixed). HARD-LOCKED: it can ONLY mint exactly one
 * HOF pass to Therec's wallet, and only when the correct secret is supplied. It
 * does the on-chain mint + provenance stamp (the part that needs the Vercel
 * admin key); the lobby reseat + cleanup are done separately via the admin SDK.
 * DELETE after running once.
 */
const THEREC = '0xdf8d910ca8caf9d3c7dea9b62d36400b38003c61';
const SECRET = 'hof-repair-7Q2x9Lp4Vt6Rn8Kc'; // one-off, removed with the file

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('secret') !== SECRET) return jsonError('forbidden', 403);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
    if (!isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

    // 1) Real on-chain mint — exactly one pass to Therec, same path the wheel uses.
    const { txHash, tokenIds } = await reserveTokensToWallet({ to: THEREC, count: 1 });
    const newId = tokenIds[0];
    if (!newId) return jsonError('mint returned no tokenId', 500);

    // 2) Stamp provenance as a HOF wheel pass (so the marketplace treats it as HOF
    //    pre-reveal, and pass_origin matches a normal wheel HOF pass).
    await recordPassOrigins({
      tokenIds: [newId],
      origin: 'spin_reward',
      ownerAtMint: THEREC,
      txHash,
      reason: 'repair:therec_hof_408_consumed_by_league29',
      level: 'hof',
    });

    // 3) Register into the spendable pool, then stamp Level=Hall of Fame so the
    //    engine's selectTokensByType + countSpendableTokens both exclude it from
    //    regular-league joins (the new prevention behavior). A HOF pass is only
    //    seatable in its special draft.
    await registerMintedTokens(THEREC, [newId], 'free');
    await getAdminFirestore()
      .collection('owners').doc(THEREC)
      .collection('validDraftTokens').doc(String(newId))
      .set({ Level: 'Hall of Fame' }, { merge: true });

    logger.info('repair.therec_hof.minted', { newId, txHash });
    return json({ ok: true, newId: String(newId), txHash });
  } catch (err) {
    logger.error('repair.therec_hof.failed', { err: (err as Error)?.message });
    return jsonError((err as Error)?.message || 'repair failed', 500);
  }
}
