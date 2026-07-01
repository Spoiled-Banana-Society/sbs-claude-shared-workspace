import { unlockBadge, resolveDraftPassType } from '@/lib/db';
import { isPastPlayer } from '@/lib/returningUsers';
import type { League } from '@/types';
import bbbChampions from '@/lib/data/champions-bbb.json';
import hofChampions from '@/lib/data/champions-hof.json';

/**
 * Award the Club badges. Entering a Jackpot or HOF draft with a PAID pass earns
 * the matching club. The resolved draft *type* (from the Go API league
 * portfolio) is the authoritative signal — the draft_entered activity event
 * can't carry the type because users don't learn it until the pack reveal.
 *
 * PAID-ONLY (Boris 2026-07-01): free-pass drafts earn NOTHING from the
 * jackpot/HOF promo surface — badge included — same rule as the spins/bells. A
 * user qualifies only if AT LEAST ONE of their jackpot/HOF drafts was entered on
 * a PAID pass, resolved server-side per draft via the authoritative token stamp
 * (`resolveDraftPassType`), never a client hint. Previously this gated only on
 * draft *type*, so every seat in a jackpot/HOF draft — free included — got the
 * club badge (the paid `jackpot-draw` path in awardJackpotDraw was always
 * correct; this backstop was the leak). Wheel jackpot/HOF wins are awarded
 * separately (in the sweep / wheel route). Idempotent.
 * See [[feedback_free_drafts_never_earn_promos]].
 */
export async function awardClubBadges(userId: string, leagues: League[]): Promise<string[]> {
  const awarded: string[] = [];
  // At least one PAID draft of the given type. `resolveDraftPassType` returns
  // 'free' | 'paid' | null (unknown) — only an explicit 'paid' qualifies, so an
  // unreadable stamp conservatively withholds the badge (self-heals next sweep).
  const hasPaidOfType = async (type: 'jackpot' | 'hof'): Promise<boolean> => {
    for (const l of leagues.filter(l => l.type === type && l.id)) {
      if ((await resolveDraftPassType(userId, l.id).catch(() => null)) === 'paid') return true;
    }
    return false;
  };
  if ((await hasPaidOfType('jackpot')) && (await unlockBadge(userId, 'jackpot-club', { source: 'entered-jackpot-paid' }))) {
    awarded.push('jackpot-club');
  }
  if ((await hasPaidOfType('hof')) && (await unlockBadge(userId, 'hof-club', { source: 'entered-hof-paid' }))) {
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
