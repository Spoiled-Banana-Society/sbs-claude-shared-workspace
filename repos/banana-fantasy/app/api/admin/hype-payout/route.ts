import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { runHypePayout } from '@/lib/hypePayout';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Banana Hype weekly payout — manual/dry-run entry point. The award engine
 * (ladder, wallet mapping, idempotency, wheel-win seat pipeline) lives in
 * lib/hypePayout.ts, shared with the hype-payout-sweep cron that now pays
 * finalized weeks automatically. This route remains for dry-run previews
 * (mode=dry, the default) and manual re-runs.
 * Auth: admin session OR x-admin-key.
 */
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
  try {
    const { fromFinal, results } = await runHypePayout(weekId, apply);
    return NextResponse.json({ weekId, mode: apply ? 'apply' : 'dry', fromFinal, results });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes('not found') ? 404 : msg.includes('not finalized') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
