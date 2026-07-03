export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { testHelpersEnabled } from '@/lib/envGates';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { BRAIN_DEFAULTS, BRAIN_DOC, type BotBrainConfig } from '@/lib/botBrainConfig';

/**
 * POST /api/admin/bots/brain/simulate — the bot brain's training loop.
 *
 * Runs a full 10-bot, 15-round snake draft in memory using the REAL ADP board
 * (playerStats2026/playerMap) and the SAME pick logic as the onBotTurn Cloud
 * Function. Pass a config in the body to trial unsaved dials; omit it to
 * simulate the currently-saved settings. Nothing is written anywhere — this is
 * a pure preview so the admin can tune → simulate → repeat.
 */
const ROUNDS = 15;
const SEATS = 10;

function typeOf(playerId: string): string {
  return playerId.split('-')[1] || '';
}

/**
 * Richard's "normal drafter" team blueprint (2026-07-02) — MUST mirror
 * drawTeamBlueprint in the onBotTurn Cloud Function: 2-3 QB, 3-4 RB1,
 * 3-4 WR1, 2-3 TE, 2-3 DST; at most one RB2 and one WR2, WR2 preferred,
 * RB2 only sometimes and only on 3-RB1 builds. Always sums to 15.
 */
function drawTeamBlueprint(rand: () => number): Record<string, number> {
  for (let tries = 0; tries < 60; tries++) {
    const t: Record<string, number> = {
      QB: rand() < 0.6 ? 2 : 3,
      RB1: rand() < 0.5 ? 3 : 4,
      WR1: rand() < 0.45 ? 3 : 4,
      TE: rand() < 0.6 ? 2 : 3,
      DST: rand() < 0.7 ? 2 : 3,
      RB2: 0,
      WR2: 0,
    };
    const rem = 15 - (t.QB + t.RB1 + t.WR1 + t.TE + t.DST);
    if (rem < 0 || rem > 2) continue;
    if (rem === 2) {
      t.WR2 = 1;
      t.RB2 = 1;
    } else if (rem === 1) {
      if (t.RB1 === 3 && rand() < 0.3) t.RB2 = 1;
      else t.WR2 = 1;
    }
    return t;
  }
  return { QB: 3, RB1: 4, WR1: 4, TE: 2, DST: 2, RB2: 0, WR2: 0 };
}

function brainPick(
  players: Record<string, { ADP?: number }>,
  taken: Set<string>,
  mine: Record<string, number>,
  targets: Record<string, number>,
  cfg: BotBrainConfig,
): { id: string; adp: number } | null {
  let available = Object.keys(players)
    .filter((id) => !taken.has(id))
    .map((id) => ({ id, adp: Number(players[id].ADP) || 999 }))
    .sort((a, b) => a.adp - b.adp);
  const needed = available.filter((s) => {
    const t = typeOf(s.id);
    if ((mine[t] ?? 0) >= (targets[t] ?? 0)) return false;
    if (t === 'RB2' && (mine.RB1 ?? 0) < 2) return false;
    if (t === 'WR2' && (mine.WR1 ?? 0) < 2) return false;
    return true;
  });
  if (needed.length > 0) available = needed;
  if (available.length === 0) return null;
  const pool = available.slice(0, Math.max(1, cfg.topN));
  const weights = pool.map((_, i) => Math.pow(0.55, i));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[0];
}

export async function POST(req: NextRequest) {
  if (!testHelpersEnabled()) return jsonError('Not available in this environment', 403);
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
    const body = await parseBody(req).catch(() => ({} as Record<string, unknown>));

    const db = getAdminFirestore();
    const [pmSnap, cfgSnap] = await Promise.all([
      db.collection('playerStats2026').doc('playerMap').get(),
      db.collection(BRAIN_DOC.col).doc(BRAIN_DOC.doc).get(),
    ]);
    const players = ((pmSnap.data() ?? {}) as { Players?: Record<string, { ADP?: number }> }).Players ?? {};
    if (Object.keys(players).length === 0) return jsonError('playerMap unavailable', 503);

    const stored = (cfgSnap.data() ?? {}) as Partial<BotBrainConfig>;
    const trial = (body.config ?? {}) as Partial<BotBrainConfig>;
    const cfg: BotBrainConfig = {
      ...BRAIN_DEFAULTS,
      ...stored,
      ...trial,
      positionCaps: {
        ...BRAIN_DEFAULTS.positionCaps,
        ...(stored.positionCaps || {}),
        ...(trial.positionCaps || {}),
      },
    };

    const taken = new Set<string>();
    const rosters: Record<string, number>[] = Array.from({ length: SEATS }, () => ({}));
    const blueprints = Array.from({ length: SEATS }, () => drawTeamBlueprint(Math.random));
    const teams: string[][] = Array.from({ length: SEATS }, () => []);
    const round1: { id: string; adp: number }[] = [];
    const order = [...Array(SEATS).keys()];
    for (let round = 0; round < ROUNDS; round++) {
      const seq = round % 2 === 0 ? order : [...order].reverse();
      for (const seat of seq) {
        const pick = brainPick(players, taken, rosters[seat], blueprints[seat], cfg);
        if (!pick) continue;
        taken.add(pick.id);
        const t = typeOf(pick.id);
        rosters[seat][t] = (rosters[seat][t] ?? 0) + 1;
        teams[seat].push(pick.id);
        if (round === 0) round1.push({ id: pick.id, adp: pick.adp });
      }
    }

    return json({
      success: true,
      configUsed: cfg,
      round1,
      teams: teams.map((picks, i) => ({ seat: i + 1, picks, counts: rosters[i] })),
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.brain.simulate.unhandled', { err });
    return jsonError('Internal Server Error', 500);
  }
}
