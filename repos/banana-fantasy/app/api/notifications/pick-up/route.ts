import { NextRequest, NextResponse } from 'next/server';
import { deliverToRecipient } from '@/lib/notifications/deliver';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET;

/**
 * POST /api/notifications/pick-up  —  EVENT B: "it's your pick".
 *
 * SERVER-TO-SERVER ONLY. The only legitimate caller is the `onPickAdvance`
 * Cloud Function, which presents a shared `x-internal-secret` header.
 *
 * Fans the alert across every channel the current drafter has connected
 * (push / email / Telegram / Discord). Atomic dedup on
 * `{wallet}__{draftId}__{pickNumber}` makes duplicate trigger fires safe.
 *
 * Body: { walletAddress, draftId, draftName?, pickNumber?, pickLengthSeconds? }
 */
export async function POST(req: NextRequest) {
  try {
    if (!INTERNAL_SECRET) {
      // Misconfiguration — the route can't authenticate any caller, so
      // every "your pick" alert silently dies. Make it loud in the Logs.
      logger.error(LOG_SOURCES.notifications.SECRET_MISSING, {
        err: 'NOTIFICATIONS_INTERNAL_SECRET is unset or blank on the Vercel deploy',
        route: 'notifications/pick-up',
      });
      return NextResponse.json(
        { error: 'NOTIFICATIONS_INTERNAL_SECRET not configured' },
        { status: 503 },
      );
    }
    if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const walletAddress =
      typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!draftId) {
      return NextResponse.json({ error: 'draftId required' }, { status: 400 });
    }

    const report = await deliverToRecipient(walletAddress, {
      type: 'draft.your_turn',
      draftId,
      draftName: typeof body.draftName === 'string' ? body.draftName : undefined,
      pickNumber: Number.isFinite(body.pickNumber) ? Number(body.pickNumber) : undefined,
      pickLengthSeconds: Number.isFinite(body.pickLengthSeconds)
        ? Number(body.pickLengthSeconds)
        : undefined,
    });

    logger.debug(
      `[pick-up] wallet=${walletAddress} draft=${draftId} outcome=${report.outcome}`,
    );
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[pick-up] Error:', err);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
  }
}
