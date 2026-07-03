export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { testHelpersEnabled } from '@/lib/envGates';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { BRAIN_DEFAULTS, BRAIN_DOC as DOC_PATH } from '@/lib/botBrainConfig';

/**
 * GET/PUT /api/admin/bots/brain — the bot brain's dials.
 *
 * Backs the "Bot Brain" card in the admin House Bots panel. The config lives
 * in Firestore `system_config/botBrain` and is read live by the `onBotTurn`
 * Cloud Function on every bot pick — saves here take effect on the bot's NEXT
 * pick, no redeploy. Field names MUST stay in sync with onBotTurn
 * (sbs-staging-functions/functions/index.js).
 */

export async function GET(req: NextRequest) {
  if (!testHelpersEnabled()) return jsonError('Not available in this environment', 403);
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
    const snap = await getAdminFirestore().collection(DOC_PATH.col).doc(DOC_PATH.doc).get();
    const stored = (snap.data() ?? {}) as Partial<typeof BRAIN_DEFAULTS>;
    return json({
      ...BRAIN_DEFAULTS,
      ...stored,
      positionCaps: { ...BRAIN_DEFAULTS.positionCaps, ...(stored.positionCaps || {}) },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.brain.get.unhandled', { err });
    return jsonError('Internal Server Error', 500);
  }
}

function num(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ApiError(400, `${name} must be a number between ${min} and ${max}`);
  }
  return Math.round(n);
}

export async function PUT(req: NextRequest) {
  if (!testHelpersEnabled()) return jsonError('Not available in this environment', 403);
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
    const body = await parseBody(req);

    const fastMin = num(body.fastMinDelaySec, 'fastMinDelaySec', 1, 25);
    const fastMax = num(body.fastMaxDelaySec, 'fastMaxDelaySec', fastMin, 28);
    const slowMin = num(body.slowMinDelaySec, 'slowMinDelaySec', 5, 600);
    const slowMax = num(body.slowMaxDelaySec, 'slowMaxDelaySec', slowMin, 900);
    const topN = num(body.topN, 'topN', 1, 20);
    const capsIn = (body.positionCaps ?? {}) as Record<string, unknown>;
    const positionCaps = {
      QB: num(capsIn.QB ?? BRAIN_DEFAULTS.positionCaps.QB, 'positionCaps.QB', 1, 15),
      RB: num(capsIn.RB ?? BRAIN_DEFAULTS.positionCaps.RB, 'positionCaps.RB', 1, 15),
      WR: num(capsIn.WR ?? BRAIN_DEFAULTS.positionCaps.WR, 'positionCaps.WR', 1, 15),
      TE: num(capsIn.TE ?? BRAIN_DEFAULTS.positionCaps.TE, 'positionCaps.TE', 1, 15),
      DST: num(capsIn.DST ?? BRAIN_DEFAULTS.positionCaps.DST, 'positionCaps.DST', 1, 15),
    };
    const cfg = {
      enabled: body.enabled === true,
      fastMinDelaySec: fastMin,
      fastMaxDelaySec: fastMax,
      slowMinDelaySec: slowMin,
      slowMaxDelaySec: slowMax,
      topN,
      positionCaps,
      updatedAt: new Date().toISOString(),
    };
    await getAdminFirestore().collection(DOC_PATH.col).doc(DOC_PATH.doc).set(cfg, { merge: true });
    logger.info('bots.brain.updated', { cfg });
    return json({ success: true, config: cfg });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.brain.put.unhandled', { err });
    return jsonError('Internal Server Error', 500);
  }
}
