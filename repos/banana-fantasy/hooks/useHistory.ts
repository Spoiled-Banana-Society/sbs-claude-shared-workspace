'use client';

import type { CompletedDraft, ContestType } from '@/types';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useAuth } from '@/hooks/useAuth';
import { getOwnerDraftTokens, type ApiDraftToken } from '@/lib/api/owner';

function levelToContestType(level: string): ContestType {
  if (level === 'Jackpot') return 'jackpot';
  if (level === 'Hall of Fame') return 'hof';
  return 'pro';
}

function mapTokenToCompletedDraft(t: ApiDraftToken): CompletedDraft {
  const roster = t.roster ?? {};
  const topPlayers: CompletedDraft['topPlayers'] = [];
  for (const [pos, players] of Object.entries(roster)) {
    if (!players?.length) continue;
    topPlayers.push(
      ...players.slice(0, 1).map((p) => ({
        position: pos,
        team: p.team ?? '',
        points: typeof p.scoreSeason === 'number' ? p.scoreSeason : 0,
      })),
    );
  }

  // Derive league name from league ID (same logic as mapDraftTokenToLeague)
  const leagueId = t.leagueId || t.cardId;
  const leagueNum = leagueId.match(/(\d+)$/)?.[1];
  const contestName = leagueNum ? `League #${leagueNum}` : (t.leagueDisplayName || `League ${leagueId}`);

  const finalPlace = t.rank ? parseInt(t.rank, 10) : 0;

  const draftSpeed: 'fast' | 'slow' = leagueId.includes('-slow-') ? 'slow' : 'fast';

  return {
    id: t.cardId,
    contestName,
    type: levelToContestType(t.level),
    finalPlace: Number.isFinite(finalPlace) ? finalPlace : 0,
    totalPlayers: 10,
    score: t.seasonScore ? Number(t.seasonScore) : 0,
    prizeWon: t.prizes?.USDC ?? 0,
    completedDate: new Date().toISOString(),
    draftSpeed,
    topPlayers,
  };
}

export function useHistory(opts?: { userId?: string }) {
  const { user } = useAuth();
  const wallet = user?.walletAddress ?? opts?.userId;

  return useSWRLike<CompletedDraft[]>(
    wallet ? `history:${wallet}` : null,
    async () => {
      const tokens = await getOwnerDraftTokens(wallet!);
      const arr = Array.isArray(tokens) ? tokens : [];
      return arr
        .filter((t) => t.rank || t.seasonScore || t.prizes)
        .map(mapTokenToCompletedDraft);
    },
    { enabled: !!wallet, fallbackData: [] },
  );
}
