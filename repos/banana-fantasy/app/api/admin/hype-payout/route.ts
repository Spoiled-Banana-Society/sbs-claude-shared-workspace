import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Banana Hype weekly payout (Boris 2026-08-20) — pays the top-25 ladder from
 * the week's snapshot:
 *   1st JackHOF seat · 2nd-3rd Jackpot seat · 4th-6th HOF seat ·
 *   7th-15th +3 Free Spins · 16th-25th +1 Free Spin.
 *
 * Seats use the EXACT wheel-win pipeline (mint pass → origin doc → Go
 * registration → Level lock → queue round join → Go league seat), so hype
 * winners land in the same filling wheel rounds as wheel winners — same
 * league when the lane's round is open, fresh round otherwise.
 *
 * Idempotent per (week, handle) via hype_payouts/{weekId}__{handle} create().
 * mode=dry (default) computes and returns the plan without writing anything.
 * Auth: admin session OR x-admin-key.
 */
const LADDER = (rank: number): { kind: 'jackhof' | 'jackpot' | 'hof' } | { spins: number } | null => {
  if (rank === 1) return { kind: 'jackhof' };
  if (rank <= 3) return { kind: 'jackpot' };
  if (rank <= 10) return { kind: 'hof' };
  if (rank <= 25) return { spins: 1 };
  return null;
};

async function authed(req: NextRequest): Promise<boolean> {
  const provided = req.headers.get('x-admin-key') || '';
  const adminKey = process.env.ADMIN_API_KEY || '';
  if (adminKey && provided === adminKey) return true;
  try { await requireAdmin(req); return true; } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const weekId = url.searchParams.get('weekId') || '';
  const apply = url.searchParams.get('mode') === 'apply';
  if (!weekId) return NextResponse.json({ error: 'weekId required' }, { status: 400 });

  const db = getAdminFirestore();
  const week = (await db.collection('mindshare_weeks').doc(weekId).get()).data();
  if (!week) return NextResponse.json({ error: 'week not found' }, { status: 404 });

  // Standings: the frozen final snapshot once the week rolled; live tiles for previews.
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
    return NextResponse.json({ error: 'week not finalized yet — refusing to apply from live tiles' }, { status: 409 });
  }

  // handle → wallet via linked X (case-insensitive).
  const links = await db.collection('v2_twitter_links').get();
  const byHandle = new Map<string, string>();
  links.forEach((d) => {
    const h = String(d.data().twitterHandle ?? '').toLowerCase();
    const w = String(d.data().walletAddress ?? '').toLowerCase();
    if (h && /^0x[0-9a-f]{40}$/.test(w)) byHandle.set(h, w);
  });
  // Boris-set per-handle wallet overrides (hype_payouts/_overrides:
  // { <handleLower>: <wallet> }) — e.g. a winner who wants the prize on a
  // different account than their X-linked wallet (RisBrian 2026-08-20).
  const overrides = (await db.collection('hype_payouts').doc('_overrides').get()).data() ?? {};
  for (const [h, w] of Object.entries(overrides)) {
    const wl = String(w).toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(wl)) byHandle.set(h.toLowerCase(), wl);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const row of ranked) {
    const prize = LADDER(row.rank);
    if (!prize) continue;
    const wallet = byHandle.get(row.handle.toLowerCase()) ?? null;
    const entry: Record<string, unknown> = { rank: row.rank, handle: row.handle, wallet, prize };
    if (!wallet) { entry.status = 'skipped-no-linked-wallet'; results.push(entry); continue; }
    if (!apply) { entry.status = 'dry'; results.push(entry); continue; }

    // Idempotency: one award per (week, handle), ever.
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
        // Seat — the wheel-win pipeline, verbatim.
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
  return NextResponse.json({ weekId, mode: apply ? 'apply' : 'dry', fromFinal: Array.isArray(week.final), results });
}
