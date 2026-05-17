import { unlockBadge } from '@/lib/db';
import type { League } from '@/types';

/**
 * Award the next-tier draft-count badge based on the user's current
 * completed-draft count. Each tier is its own badge (per the locked
 * design decision — tiers don't auto-replace). Idempotent via
 * unlockBadge's transactional check.
 */
export async function awardDraftCountBadges(userId: string, completedDrafts: number): Promise<void> {
  if (completedDrafts >= 1) await unlockBadge(userId, 'first-draft', { completedDrafts });
  if (completedDrafts >= 20) await unlockBadge(userId, 'drafts-20', { completedDrafts });
  if (completedDrafts >= 50) await unlockBadge(userId, 'drafts-50', { completedDrafts });
  if (completedDrafts >= 100) await unlockBadge(userId, 'drafts-100', { completedDrafts });
}

/**
 * Inspect a user's leagues and award the regular-season badges:
 *   - league-winner-{type} for any 1st-place finish in a Pro/JP/HOF league
 *   - made-playoffs for any top-2 finish
 *
 * Run after week 14 closes (or when a league's regular-season standings
 * are final). Each unlock is idempotent.
 */
export async function awardLeagueOutcomeBadges(
  userId: string,
  leagues: League[],
): Promise<{ awards: string[] }> {
  const awarded: string[] = [];
  let madePlayoffs = false;
  let proWinner = false;
  let jpWinner = false;
  let hofWinner = false;

  for (const l of leagues) {
    if (l.leagueRank === 1) {
      if (l.type === 'jackpot') jpWinner = true;
      else if (l.type === 'hof') hofWinner = true;
      else proWinner = true; // 'pro' or 'regular'
    }
    if (l.leagueRank > 0 && l.leagueRank <= 2) madePlayoffs = true;
  }

  if (proWinner && (await unlockBadge(userId, 'league-winner-pro'))) awarded.push('league-winner-pro');
  if (jpWinner && (await unlockBadge(userId, 'league-winner-jp'))) awarded.push('league-winner-jp');
  if (hofWinner && (await unlockBadge(userId, 'league-winner-hof'))) awarded.push('league-winner-hof');
  if (madePlayoffs && (await unlockBadge(userId, 'made-playoffs'))) awarded.push('made-playoffs');

  return { awards: awarded };
}

/**
 * Award beat-founder when the user's score exceeded the founder's score
 * in the same Founder draft. Caller passes the matched score pairs (one
 * per Founder league the user was in).
 */
export async function awardBeatFounderIfEarned(
  userId: string,
  pairs: Array<{ draftId: string; userScore: number; founderScore: number }>,
): Promise<boolean> {
  const beat = pairs.find(p => p.userScore > p.founderScore);
  if (!beat) return false;
  return unlockBadge(userId, 'beat-founder', {
    draftId: beat.draftId,
    userScore: beat.userScore,
    founderScore: beat.founderScore,
  });
}
