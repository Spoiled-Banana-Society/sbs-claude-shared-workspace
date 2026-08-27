import { logger } from '@/lib/logger';

/**
 * Discord lobby-countdown cleanup.
 *
 * The SBS Draft Bot (Render, no source access) posts an @everyone ping every
 * time a lobby's remaining-seat count changes: "**3** more to fill Draft Lobby
 * (Fast)" → "**2** more…" → … → "**0** more to fill League #N (Fast)". Richard
 * wants only the LATEST count visible per lobby: when "2 more" lands, the
 * "3 more" message goes away, and once the fill message lands only the
 * "0 more to fill League #N" line stays.
 *
 * We can't change the bot, so this sweeps #general once a minute via the
 * Discord REST API:
 *   - read the last N messages
 *   - pick out bot-authored "X more to fill …" messages
 *   - group by speed (Fast/Slow — the countdown text carries no draft number)
 *   - per speed, keep the newest message untouched; delete every OLDER
 *     countdown ("Draft Lobby") message
 *   - fill messages ("League #N") are never deleted
 *
 * Needs DISCORD_BOT_TOKEN. If that token belongs to the Draft Bot itself, no
 * extra permission is needed (a bot can always delete its own messages);
 * a separate bot needs View Channel + Read Message History + Manage Messages
 * in the channel. Fails closed (no-op) when the token is missing.
 *
 * Caveat: two lobbies of the same speed filling at once are indistinguishable
 * in the text, so only the newest of the two counts survives — acceptable per
 * the "just keep the latest" ask.
 */

const DISCORD_API = 'https://discord.com/api/v10';
// #general in the Spoiled Banana Society server — same channel the bot's
// AdminJS config points at.
const DEFAULT_CHANNEL_ID = '982576024523014164';
const FETCH_LIMIT = 50;
const MAX_DELETES_PER_RUN = 10;

// "**3** more to fill Draft Lobby (Fast)" / "**0** more to fill League #893 (Slow)"
const COUNTDOWN_RE = /^\*{0,2}(\d+)\*{0,2} more to fill (Draft Lobby|League #\d+) \((Fast|Slow)\)/i;

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; bot?: boolean; username?: string };
  webhook_id?: string;
};

type Parsed = {
  id: string;
  speed: 'fast' | 'slow';
  isCountdown: boolean;
  remaining: number;
  ts: string;
};

export function parseLobbyMessage(m: DiscordMessage): Parsed | null {
  // Only ever touch automated posts — never a human's message that happens to
  // mimic the format.
  if (!m.author?.bot && !m.webhook_id) return null;
  const match = COUNTDOWN_RE.exec(m.content ?? '');
  if (!match) return null;
  return {
    id: m.id,
    speed: match[3].toLowerCase() as 'fast' | 'slow',
    isCountdown: /^draft lobby$/i.test(match[2]),
    remaining: Number(match[1]),
    ts: m.timestamp,
  };
}

/** Pure planner: given messages newest-first, return the ids to delete. */
export function planLobbyDeletes(messages: DiscordMessage[]): string[] {
  const sorted = [...messages].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)); // snowflakes: newest first
  const seenSpeed = new Set<string>();
  const out: string[] = [];
  for (const m of sorted) {
    const p = parseLobbyMessage(m);
    if (!p) continue;
    if (!seenSpeed.has(p.speed)) {
      // Newest message for this speed — always keep (countdown or fill).
      seenSpeed.add(p.speed);
      continue;
    }
    if (p.isCountdown) out.push(p.id);
    // Older fill messages ("League #N") are history — keep.
  }
  return out;
}

async function discord(path: string, init: RequestInit & { token: string }) {
  const { token, ...rest } = init;
  return fetch(`${DISCORD_API}${path}`, {
    ...rest,
    // Route-handler fetch cache would serve stale forever — never cache.
    cache: 'no-store',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
  });
}

export async function runDiscordLobbyCleanup(): Promise<{
  ok: boolean;
  skipped?: string;
  scanned?: number;
  planned?: number;
  deleted?: number;
  errors?: string[];
}> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, skipped: 'no DISCORD_BOT_TOKEN' };
  const channelId = process.env.DISCORD_LOBBY_CHANNEL_ID?.trim() || DEFAULT_CHANNEL_ID;

  const res = await discord(`/channels/${channelId}/messages?limit=${FETCH_LIMIT}`, { token });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error('discord_lobby_cleanup.fetch_failed', { status: res.status, body: body.slice(0, 200) });
    return { ok: false, skipped: `fetch ${res.status}` };
  }
  const messages = (await res.json()) as DiscordMessage[];
  const plan = planLobbyDeletes(messages);
  const errors: string[] = [];
  let deleted = 0;
  for (const id of plan.slice(0, MAX_DELETES_PER_RUN)) {
    const del = await discord(`/channels/${channelId}/messages/${id}`, {
      token,
      method: 'DELETE',
      headers: { 'X-Audit-Log-Reason': 'superseded lobby countdown' },
    });
    if (del.status === 204 || del.status === 404) {
      deleted += 1;
    } else {
      const body = await del.text().catch(() => '');
      errors.push(`${id}: ${del.status} ${body.slice(0, 120)}`);
      if (del.status === 429) break; // back off; next minute picks it up
    }
    // Stay well under Discord's per-channel delete limit (5 / 5s).
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (deleted || errors.length) {
    logger.info('discord_lobby_cleanup.run', { scanned: messages.length, planned: plan.length, deleted, errors });
  }
  return { ok: errors.length === 0, scanned: messages.length, planned: plan.length, deleted, errors };
}
