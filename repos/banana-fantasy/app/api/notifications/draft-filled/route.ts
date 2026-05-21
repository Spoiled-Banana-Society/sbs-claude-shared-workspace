import { NextRequest, NextResponse } from 'next/server';
import { deliverToRecipient } from '@/lib/notifications/deliver';
import { logger } from '@/lib/logger';

const INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET;

/**
 * POST /api/notifications/draft-filled  —  EVENT A: "your draft filled".
 *
 * SERVER-TO-SERVER ONLY. Called by the `onDraftFilled` Cloud Function when
 * a draft reaches 10 players. Fans an alert to every league member across
 * each channel they've connected. Atomic dedup on `{wallet}__{draftId}__filled`
 * makes duplicate trigger fires safe.
 *
 * Body: { draftId, draftName?, wallets: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    if (!INTERNAL_SECRET) {
      return NextResponse.json(
        { error: 'NOTIFICATIONS_INTERNAL_SECRET not configured' },
        { status: 503 },
      );
    }
    if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const draftName = typeof body.draftName === 'string' ? body.draftName : undefined;
    const wallets: string[] = Array.isArray(body.wallets)
      ? body.wallets.filter((w: unknown): w is string => typeof w === 'string' && w.length > 0)
      : [];

    if (!draftId) {
      return NextResponse.json({ error: 'draftId required' }, { status: 400 });
    }
    if (wallets.length === 0) {
      return NextResponse.json({ ok: true, reports: [] });
    }

    const event = { type: 'draft.filled' as const, draftId, draftName };

    // One bad recipient (e.g. a dedup-store hiccup) must not sink the batch.
    const reports = await Promise.all(
      wallets.map((w) =>
        deliverToRecipient(w, event).catch((err) => ({
          walletAddress: w.toLowerCase(),
          outcome: 'failed' as const,
          error: err instanceof Error ? err.message : String(err),
        })),
      ),
    );

    logger.debug(`[draft-filled] draft=${draftId} recipients=${wallets.length}`);
    return NextResponse.json({ ok: true, reports });
  } catch (err) {
    console.error('[draft-filled] Error:', err);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
  }
}
