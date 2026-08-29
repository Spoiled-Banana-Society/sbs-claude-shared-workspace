import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

/**
 * Reveal-credit backstop (Boris 2026-08-29: "it should always give credit
 * once a draft fills"). The reveal-stage promo credits (ATB slots, Pick 10,
 * chase, jackpot draws, club badges) run in /api/drafts/{id}/reveal-complete,
 * which is fired by CLIENTS watching the reveal animation — a draft that
 * fills with nobody watching (rdvdaboss's 6 AM slow draft, BBB #986) never
 * gets the call and every player's credits silently skip. ~1 in 40 fills.
 *
 * This sweep makes the server press its own button: every 5 minutes it takes
 * the last 48h of fills, skips drafts already stamped `revealCreditedAt`
 * (written by the route itself on every successful pass), waits 5 minutes
 * past fill so it can never front-run a live reveal animation, then POSTs
 * the same public route the clients use. Everything downstream is idempotent
 * (per-user seen-ledgers, create-once unlock docs), so re-fires are no-ops —
 * the sweep can only ever pay credits that were missed. Bells Boris whenever
 * it actually rescues a draft.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || (req.headers.get('authorization') ?? '') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  const origin = new URL(req.url).origin;
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const GRACE_MS = 5 * 60_000;

  const ev = await db.collection('v2_activity_events')
    .where('type', '==', 'draft_filled')
    .where('createdAtIso', '>=', since)
    .get();
  const fills = new Map<string, string>(); // draftId -> latest fill iso
  ev.forEach((d) => {
    const e = d.data();
    const id = (e.metadata as { draftId?: string } | undefined)?.draftId;
    if (id && (!fills.has(id) || String(e.createdAtIso) > fills.get(id)!)) fills.set(id, String(e.createdAtIso));
  });

  const rescued: string[] = [];
  const failed: string[] = [];
  for (const [id, at] of fills) {
    if (Date.now() - Date.parse(at) < GRACE_MS) continue; // reveal may still be animating
    const draft = (await db.collection('drafts').doc(id).get()).data();
    if (!draft || draft.revealCreditedAt) continue; // already processed (stamp set on every route pass)
    try {
      const res = await fetch(`${origin}/api/drafts/${encodeURIComponent(id)}/reveal-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) rescued.push(id); else failed.push(`${id} (${res.status})`);
    } catch (e) {
      failed.push(`${id} (${(e as Error).message.slice(0, 40)})`);
    }
  }

  if (rescued.length || failed.length) {
    await db.collection('marketplace_notifications').doc(`${ADMIN_BELL_WALLET}__credit-sweep-${Date.now()}`).create({
      wallet: ADMIN_BELL_WALLET, type: 'promo', title: '🛠 Reveal credits rescued',
      message: [
        rescued.length ? `Credited drafts nobody watched: ${rescued.join(', ')}.` : '',
        failed.length ? `FAILED (will retry next sweep): ${failed.join(', ')}.` : '',
      ].filter(Boolean).join('\n'),
      link: '/admin?tab=drafts', dedupeKey: `credit-sweep-${Date.now()}`,
      icon: '🛠', read: false, createdAt: new Date(),
    }).catch(() => { /* bell is best-effort */ });
  }
  return NextResponse.json({ ok: true, checked: fills.size, rescued, failed });
}
