export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { runDiscordLobbyCleanup } from '@/lib/discordLobbyCleanup';

/**
 * GET /api/crons/discord-lobby-cleanup — every minute. Deletes superseded
 * "X more to fill Draft Lobby" pings in #general so only the latest count (or
 * the final "0 more to fill League #N") stays. See lib/discordLobbyCleanup.
 */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  const result = await runDiscordLobbyCleanup().catch((err) => {
    logger.error('discord_lobby_cleanup.cron_failed', { err: (err as Error).message });
    return { ok: false, skipped: (err as Error).message };
  });
  return json(result);
}
