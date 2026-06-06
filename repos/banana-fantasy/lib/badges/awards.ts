import { unlockBadge } from '@/lib/db';
import { isPastPlayer } from '@/lib/returningUsers';
import type { League } from '@/types';
import bbbChampions from '@/lib/data/champions-bbb.json';
import hofChampions from '@/lib/data/champions-hof.json';

/**
 * Award the Club badges. Entering a Jackpot or HOF draft earns the matching
 * club. The resolved draft *type* (from the Go API league portfolio) is the
 * authoritative signal — the draft_entered activity event can't carry the
 * type because users don't learn it until the pack reveal. Wheel jackpot/HOF
 * wins are awarded separately (in the sweep / wheel route). Idempotent.
 */
export async function awardClubBadges(userId: string, leagues: League[]): Promise<string[]> {
  const awarded: string[] = [];
  const hasJackpot = leagues.some(l => l.type === 'jackpot');
  const hasHof = leagues.some(l => l.type === 'hof');
  if (hasJackpot && (await unlockBadge(userId, 'jackpot-club', { source: 'entered-jackpot' }))) {
    awarded.push('jackpot-club');
  }
  if (hasHof && (await unlockBadge(userId, 'hof-club', { source: 'entered-hof' }))) {
    awarded.push('hof-club');
  }
  return awarded;
}

/**
 * Award the OG badge to returning players — anyone who played in a past SBS
 * season (lib/returningUsers.ts: on-chain BBB holders + the all-time
 * past-players snapshot). Idempotent.
 */
export async function awardOgIfReturning(userId: string): Promise<boolean> {
  if (!isPastPlayer(userId)) return false;
  return unlockBadge(userId, 'og', { source: 'past-player' });
}

/** Numeric season keys → winner wallets, skipping the `_comment` doc key and
 *  any non-array value, so the JSON can stay self-documenting. */
function championEntries(map: Record<string, unknown>): Array<[string, string[]]> {
  return Object.entries(map)
    .filter(([k, v]) => /^\d+$/.test(k) && Array.isArray(v))
    .map(([k, v]): [string, string[]] => [k, (v as string[]).map(w => w.toLowerCase())]);
}

/**
 * Award Champion badges from the winner-wallet snapshots
 * (lib/data/champions-*.json). Empty until Boris supplies the lists — until
 * then champions are admin-grant only. Idempotent.
 */
export async function awardChampionBadges(userId: string): Promise<string[]> {
  const lower = userId.toLowerCase();
  const awarded: string[] = [];
  for (const [season, wallets] of championEntries(bbbChampions as Record<string, unknown>)) {
    if (wallets.includes(lower)) {
      const id = `bbb-champion-${season}`;
      if (await unlockBadge(userId, id, { source: 'champion-snapshot' })) awarded.push(id);
    }
  }
  for (const [season, wallets] of championEntries(hofChampions as Record<string, unknown>)) {
    if (wallets.includes(lower)) {
      const id = `hof-champion-${season}`;
      if (await unlockBadge(userId, id, { source: 'champion-snapshot' })) awarded.push(id);
    }
  }
  return awarded;
}
