import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { runHypePayout } from '@/lib/hypePayout';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

/**
 * Pays any finalized Banana Hype week that hasn't been paid — the hands-off
 * successor to the manual-review payout (Boris 2026-08-27: the 8/27 week
 * finalized and reset with nothing credited; prizes must never depend on
 * someone remembering). Award logic + per-(week, handle) idempotency live in
 * lib/hypePayout.ts, so a re-run — or a week already paid by the admin
 * route — is a no-op. Only weeks finalized in the last 21 days are swept:
 * anything older going unpaid is a situation for a human, not a cron.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  const cutoff = Date.now() - 21 * 24 * 3600_000;
  const weeks = await db.collection('mindshare_weeks').get();
  const summary: Record<string, { paid: number; already: number; failed: string[] }> = {};

  for (const w of weeks.docs) {
    const d = w.data();
    if (d.status !== 'final' || !Array.isArray(d.final) || !d.final.length) continue;
    if (Number(d.endsAtMs ?? 0) < cutoff) continue;
    const { results } = await runHypePayout(w.id, true);
    const paid = results.filter((r) => r.status === 'seat-granted' || r.status === 'spins-credited');
    const failed = results.filter((r) => r.status.startsWith('FAILED') || r.status === 'skipped-no-linked-wallet');
    if (paid.length || failed.length) {
      summary[w.id] = {
        paid: paid.length,
        already: results.filter((r) => r.status === 'already-paid').length,
        failed: failed.map((r) => `#${r.rank} ${r.handle}: ${r.status}`),
      };
    }
  }

  const acted = Object.entries(summary).filter(([, s]) => s.paid || s.failed.length);
  if (acted.length) {
    const msg = acted.map(([id, s]) =>
      `${id}: ${s.paid} paid${s.failed.length ? `\nISSUES:\n${s.failed.join('\n')}` : ''}`,
    ).join('\n');
    await db.collection('marketplace_notifications').doc(`${ADMIN_BELL_WALLET}__hype-sweep-${Date.now()}`).create({
      wallet: ADMIN_BELL_WALLET, type: 'promo', title: '🔥 Hype prizes paid',
      message: msg, link: '/mindshare', dedupeKey: `hype-sweep-${Date.now()}`,
      icon: '🔥', read: false, createdAt: new Date(),
    }).catch(() => { /* bell is best-effort */ });
  }
  return NextResponse.json({ ok: true, summary });
}
