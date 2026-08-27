import { NextResponse } from 'next/server';
import { getAdminFirestore, getAdminDatabase } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Slow-draft pointer-freeze self-heal (Boris 2026-08-27, "we can do that
 * ourselves"). Third manual rescue in three days made it a pattern: a slow
 * draft records a pick in the summary but the turn pointer (RTDB
 * realTimeDraftInfo + state/info) never advances — the room shows the picked
 * player AND "YOUR TURN TO DRAFT" forever, the expiry auto-pick is rejected
 * ("already held") and nothing moves. The Go watchdog only detects store
 * CONFLICTS; in this variant every store agrees, so it reads as healthy.
 *
 * This cron applies EXACTLY the write the engine's own advance would have
 * made — the same recipe as the three successful manual heals (slow-45 8/25,
 * slow-50 + 108/110 8/27), nothing more: pointer → N+1, drafter/onDeck from
 * DraftOrder snake math, lastPick = the recorded pick, fresh pickLength
 * clock, state/info mirrored.
 *
 * Safety, by construction:
 *  - Signature requires the summary to CONTAIN the pointer's pick (recorded
 *    but unadvanced) — a live turn has summary == pointer-1 and never matches.
 *  - 20-minute staleness gate: a healthy advance completes in <1s, so a
 *    matching signature younger than 20 min is skipped (mid-write race).
 *  - Slow drafts only; a final pick that would COMPLETE the draft is never
 *    touched (engine completion runs reveal logic we won't imitate) — bells
 *    Boris for a manual look instead.
 *  - Every heal bells Boris — nothing happens silently.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  const rtdb = getAdminDatabase();
  const STALE_MS = 20 * 60_000;
  const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
  const healed: string[] = [];
  const flagged: string[] = [];

  const all = (await rtdb.ref('drafts').once('value')).val() ?? {};
  for (const [id, d] of Object.entries(all) as [string, { displayName?: string; realTimeDraftInfo?: Record<string, unknown> }][]) {
    if (!id.includes('slow-draft')) continue;
    const rt = d.realTimeDraftInfo as {
      pickNumber?: number; pickStartTime?: number; pickLength?: number;
      isDraftComplete?: boolean; currentDrafter?: string;
    } | undefined;
    if (!rt || rt.isDraftComplete || !rt.pickNumber) continue;
    if (Date.now() - Number(rt.pickStartTime ?? 0) * 1000 < STALE_MS) continue;

    const sumDoc = await db.doc(`drafts/${id}/state/summary`).get();
    const picks = ((sumDoc.data()?.Summary ?? []) as Array<{ PlayerInfo?: { PlayerId?: string; PickNum?: number; OwnerAddress?: string; DisplayName?: string; Position?: string; Round?: number; Team?: string } }>)
      .map((e) => e.PlayerInfo)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.PlayerId));
    const last = picks[picks.length - 1];
    if (!last || Number(last.PickNum) !== Number(rt.pickNumber)) continue; // not the frozen signature

    const info = (await db.doc(`drafts/${id}/state/info`).get()).data() as { DraftOrder?: Array<{ OwnerId: string }> } | undefined;
    const order = (info?.DraftOrder ?? []).map((o) => o.OwnerId);
    const seats = order.length;
    if (!seats) continue;
    const N = Number(rt.pickNumber) + 1;
    if (N > seats * 15) { flagged.push(id); continue; } // would complete the draft — humans only

    const seatIdx = (p: number) => {
      const r = Math.ceil(p / seats);
      const pos = p - (r - 1) * seats;
      return { r, pos, idx: r % 2 === 1 ? pos - 1 : seats - pos };
    };
    const nx = seatIdx(N);
    const od = N + 1 <= seats * 15 ? seatIdx(N + 1) : nx;
    const len = Number(rt.pickLength) || 28800;
    const nowS = Math.floor(Date.now() / 1000);
    await rtdb.ref(`drafts/${id}/realTimeDraftInfo`).update({
      lastPick: {
        displayName: last.DisplayName ?? last.PlayerId, ownerAddress: last.OwnerAddress ?? '',
        pickNum: Number(last.PickNum), playerId: last.PlayerId, position: last.Position ?? '',
        round: Number(last.Round) || nx.r, team: last.Team ?? '',
      },
      pickNumber: N, pickInRound: nx.pos, roundNum: nx.r,
      currentDrafter: order[nx.idx], onDeckDrafter: order[od.idx],
      pickStartTime: nowS, pickEndTime: nowS + len,
    });
    await db.doc(`drafts/${id}/state/info`).update({
      CurrentPickNumber: N, PickInRound: nx.pos, CurrentRound: nx.r, CurrentDrafter: order[nx.idx],
    });
    healed.push(`${id}→pick ${N}`);
  }

  if (healed.length || flagged.length) {
    const msg = [
      healed.length ? `Auto-healed pointer freeze: ${healed.join(', ')}.` : '',
      flagged.length ? `NEEDS MANUAL (final pick): ${flagged.join(', ')}.` : '',
    ].filter(Boolean).join('\n');
    await db.collection('marketplace_notifications').doc(`${ADMIN_BELL_WALLET}__pointer-heal-${Date.now()}`).create({
      wallet: ADMIN_BELL_WALLET, type: 'promo', title: '🛠 Slow-draft pointer heal',
      message: msg, link: '/admin?tab=drafts', dedupeKey: `pointer-heal-${Date.now()}`,
      icon: '🛠', read: false, createdAt: FieldValue.serverTimestamp(),
    }).catch(() => { /* bell is best-effort */ });
  }
  return NextResponse.json({ ok: true, healed, flagged });
}
