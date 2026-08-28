import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { logger } from '@/lib/logger';

/**
 * Banana Hype weekly payout — the award engine behind both the admin route
 * (manual/dry runs) and the payout-sweep cron (hands-off weekly pay since
 * 2026-08-27, when the 8/27 week finalized unpaid and Boris ended the
 * manual-review era). Ladder must stay in lockstep with the /mindshare page
 * and HypeCard: 1st JackHOF · 2-3 Jackpot · 4-10 HOF · 11-25 1 Free Spin.
 *
 * Seats ride the wheel-win pipeline (mint pass → origin → Go registration →
 * Level lock → queue round join → Go league seat). joinQueueWithToken's
 * findOpenRound skips any filling round already holding one of the winner's
 * linked wallets, so a winner with an existing seat lands in a different or
 * fresh round — never doubled into the same league.
 *
 * Idempotent per (week, handle) via hype_payouts/{weekId}__{handle} create().
 */
export const HYPE_LADDER = (rank: number): { kind: 'jackhof' | 'jackpot' | 'hof' } | { spins: number } | null => {
  if (rank === 1) return { kind: 'jackhof' };
  if (rank <= 3) return { kind: 'jackpot' };
  if (rank <= 10) return { kind: 'hof' };
  if (rank <= 25) return { spins: 1 };
  return null;
};

export interface HypeAwardResult {
  rank: number; handle: string; wallet: string | null;
  prize: ReturnType<typeof HYPE_LADDER>;
  status: string; tokenId?: string; roundId?: number | null;
}

export async function runHypePayout(weekId: string, apply: boolean): Promise<{ fromFinal: boolean; results: HypeAwardResult[] }> {
  const db = getAdminFirestore();
  const week = (await db.collection('mindshare_weeks').doc(weekId).get()).data();
  if (!week) throw new Error(`week ${weekId} not found`);

  let ranked: Array<{ rank: number; handle: string; score: number }>;
  if (Array.isArray(week.final) && week.final.length) {
    ranked = week.final as typeof ranked;
  } else {
    const tiles = await db.collection('mindshare_weeks').doc(weekId).collection('tiles').get();
    ranked = tiles.docs
      .map((d) => ({ handle: String(d.data().handle ?? d.id), score: (Number(d.data().attention) || 0) + (Number(d.data().refBonus) || 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((t, i) => ({ rank: i + 1, ...t }));
  }
  if (apply && !Array.isArray(week.final)) {
    throw new Error('week not finalized yet — refusing to apply from live tiles');
  }

  const links = await db.collection('v2_twitter_links').get();
  const byHandle = new Map<string, string>();
  links.forEach((d) => {
    const h = String(d.data().twitterHandle ?? '').toLowerCase();
    const w = String(d.data().walletAddress ?? '').toLowerCase();
    if (h && /^0x[0-9a-f]{40}$/.test(w)) byHandle.set(h, w);
  });
  const overrides = (await db.collection('hype_payouts').doc('_overrides').get()).data() ?? {};
  for (const [h, w] of Object.entries(overrides)) {
    const wl = String(w).toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(wl)) byHandle.set(h.toLowerCase(), wl);
  }

  const results: HypeAwardResult[] = [];
  for (const row of ranked) {
    const prize = HYPE_LADDER(row.rank);
    if (!prize) continue;
    const wallet = byHandle.get(row.handle.toLowerCase()) ?? null;
    const entry: HypeAwardResult = { rank: row.rank, handle: row.handle, wallet, prize, status: 'dry' };
    if (!wallet) { entry.status = 'skipped-no-linked-wallet'; results.push(entry); continue; }
    if (!apply) { results.push(entry); continue; }

    const guardRef = db.collection('hype_payouts').doc(`${weekId}__${row.handle.toLowerCase()}`);
    try {
      await guardRef.create({ weekId, handle: row.handle, wallet, rank: row.rank, prize, at: FieldValue.serverTimestamp() });
    } catch { entry.status = 'already-paid'; results.push(entry); continue; }

    try {
      if ('spins' in prize) {
        await db.collection('v2_users').doc(wallet).set({ wheelSpins: FieldValue.increment(prize.spins) }, { merge: true });
        const { createNotification } = await import('@/lib/queueNotifications');
        await createNotification(wallet, {
          type: 'promo',
          title: `You won ${prize.spins} Free Spin${prize.spins === 1 ? '' : 's'} — Banana Hype`,
          message: `You finished #${row.rank} on this week's Hype board. ${prize.spins} Free Spin${prize.spins === 1 ? '' : 's'} added — the new week just started, run it back.`,
          link: '/banana-wheel',
          dedupeKey: `hype-payout-${weekId}-${row.handle.toLowerCase()}`,
          icon: 'fire',
        });
        entry.status = 'spins-credited';
      } else {
        const kind = prize.kind;
        const res = await reserveTokensToWallet({ to: wallet, count: 1 });
        await recordPassOrigins({ tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: wallet, txHash: res.txHash, reason: `hype:${weekId}:rank${row.rank}`, level: kind });
        try { await registerMintedTokens(wallet, res.tokenIds.map(Number), 'free'); }
        catch (e) { logger.warn('hype_payout.register_go_failed', { wallet, err: (e as Error).message }); }
        const specialLevel = kind === 'jackpot' ? 'Jackpot' : kind === 'hof' ? 'Hall of Fame' : 'JackHOF';
        await Promise.all(res.tokenIds.map((tid) =>
          db.collection('owners').doc(wallet).collection('validDraftTokens').doc(String(tid)).set({ Level: specialLevel }, { merge: true }),
        ));
        const tokenId = String(res.tokenIds[0] ?? '');
        let joinedRoundId: number | null = null;
        if (tokenId) {
          const { joinQueueWithToken } = await import('@/lib/db');
          ({ joinedRoundId } = await joinQueueWithToken(wallet, kind, tokenId, 'wheel'));
          if (joinedRoundId !== null) {
            const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
            await ensureSpecialDraftSeat(kind, joinedRoundId, wallet);
          }
        }
        const seatName = kind === 'jackhof' ? 'JackHOF' : kind === 'jackpot' ? 'Jackpot' : 'HOF';
        const { createNotification } = await import('@/lib/queueNotifications');
        await createNotification(wallet, {
          type: 'promo',
          title: `You won a ${seatName} seat — Banana Hype`,
          message: `You finished #${row.rank} on this week's Hype board. Your ${seatName} draft seat is live — you're in the lobby.`,
          link: '/teams',
          dedupeKey: `hype-payout-${weekId}-${row.handle.toLowerCase()}`,
          icon: 'crown',
        });
        entry.status = 'seat-granted';
        entry.tokenId = tokenId;
        entry.roundId = joinedRoundId;
      }
    } catch (e) {
      entry.status = `FAILED: ${(e as Error).message.slice(0, 160)}`;
      logger.error('hype_payout.award_failed', { weekId, handle: row.handle, wallet, err: (e as Error).message });
    }
    results.push(entry);
  }

  logger.info('hype_payout.run', { weekId, apply, count: results.length });
  return { fromFinal: Array.isArray(week.final), results };
}
