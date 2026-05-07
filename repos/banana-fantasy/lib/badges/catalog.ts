import type { Badge } from '@/types';

/**
 * Single source of truth for all badges. Same pattern as the promo seed
 * list — ordered as displayed in the catalog grid. Adding a badge here +
 * deploying is sufficient for new users to see it; existing users get the
 * lazy-backfill on their next /api/badges read.
 */
export const BADGE_CATALOG: Badge[] = [
  // ── Drafts ───────────────────────────────────────────────────────────
  {
    id: 'first-draft',
    label: 'First Draft',
    description: 'Completed your first draft. Welcome to SBS.',
    criteria: 'Complete 1 draft',
    category: 'drafts',
    color: '#94a3b8', // slate-400
    glyph: '🍌',
  },
  {
    id: 'drafts-20',
    label: 'Veteran',
    description: '20 drafts deep. You know the lobby by heart.',
    criteria: 'Complete 20 drafts',
    category: 'drafts',
    color: '#60a5fa', // blue-400
    glyph: '★',
  },
  {
    id: 'drafts-100',
    label: 'Centurion',
    description: '100 drafts. Certified degenerate.',
    criteria: 'Complete 100 drafts',
    category: 'drafts',
    color: '#a855f7', // purple-500
    glyph: '💯',
  },

  // ── League winners (weeks 1–14) ──────────────────────────────────────
  {
    id: 'league-winner-pro',
    label: 'Pro League Winner',
    description: '1st place in your Pro draft pod, weeks 1–14.',
    criteria: 'Finish 1st in a Pro league regular season',
    category: 'league',
    color: '#a855f7', // pro purple
    glyph: '👑',
  },
  {
    id: 'league-winner-jp',
    label: 'Jackpot League Winner',
    description: '1st place in your Jackpot draft pod — straight to the finals.',
    criteria: 'Finish 1st in a Jackpot league regular season',
    category: 'league',
    color: '#ef4444', // jackpot red
    glyph: '👑',
  },
  {
    id: 'league-winner-hof',
    label: 'HOF League Winner',
    description: '1st place in your HOF draft pod — into the HOF playoffs.',
    criteria: 'Finish 1st in a HOF league regular season',
    category: 'league',
    color: '#D4AF37', // hof gold
    glyph: '👑',
  },
  {
    id: 'made-playoffs',
    label: 'Playoff Bound',
    description: 'Top 2 in your league regular season — made the playoffs.',
    criteria: 'Finish top 2 in any league regular season',
    category: 'league',
    color: '#22c55e', // green-500
    glyph: '🏈',
  },

  // ── Finals (BBB main bracket) ────────────────────────────────────────
  {
    id: 'made-finals',
    label: 'Finalist',
    description: 'Reached the week-17 finals. The big stage.',
    criteria: 'Reach the BBB finals',
    category: 'finals',
    color: '#facc15', // yellow-400
    glyph: '🎯',
  },
  {
    id: 'bbb-bronze',
    label: 'BBB Bronze',
    description: '3rd place in the BBB finals.',
    criteria: 'Finish 3rd in the BBB finals',
    category: 'finals',
    color: '#cd7f32', // bronze
    glyph: '🥉',
  },
  {
    id: 'bbb-silver',
    label: 'BBB Silver',
    description: '2nd place in the BBB finals.',
    criteria: 'Finish 2nd in the BBB finals',
    category: 'finals',
    color: '#c0c0c0', // silver
    glyph: '🥈',
  },
  {
    id: 'bbb-champion',
    label: 'BBB Champion',
    description: 'BBB Champion. The whole damn season.',
    criteria: 'Win the BBB finals',
    category: 'finals',
    color: '#ffd700', // gold
    glyph: '🏆',
  },

  // ── HOF playoffs (weeks 15–17 cumulative) ────────────────────────────
  {
    id: 'hof-bronze',
    label: 'HOF Bronze',
    description: '3rd place in HOF playoffs.',
    criteria: 'Finish 3rd in the HOF playoff bracket',
    category: 'finals',
    color: '#cd7f32',
    glyph: '🥉',
  },
  {
    id: 'hof-silver',
    label: 'HOF Silver',
    description: '2nd place in HOF playoffs.',
    criteria: 'Finish 2nd in the HOF playoff bracket',
    category: 'finals',
    color: '#c0c0c0',
    glyph: '🥈',
  },
  {
    id: 'hof-champion',
    label: 'HOF Champion',
    description: 'Won the HOF playoffs. Untouchable.',
    criteria: 'Win the HOF playoff bracket',
    category: 'finals',
    color: '#D4AF37',
    glyph: '🏆',
  },

  // ── Wheel ────────────────────────────────────────────────────────────
  {
    id: 'spin-jackpot',
    label: 'Lucky Spin (JP)',
    description: 'Hit Jackpot on the wheel.',
    criteria: 'Land on Jackpot on a wheel spin',
    category: 'wheel',
    color: '#ef4444',
    glyph: '🎰',
  },
  {
    id: 'spin-hof',
    label: 'Lucky Spin (HOF)',
    description: 'Hit HOF on the wheel.',
    criteria: 'Land on HOF on a wheel spin',
    category: 'wheel',
    color: '#D4AF37',
    glyph: '🎰',
  },

  // ── Founder ──────────────────────────────────────────────────────────
  {
    id: 'beat-founder',
    label: 'Beat the Founder',
    description: 'Outscored the founder in your Founder league, weeks 1–14.',
    criteria: 'Score more than the founder in a Founder league regular season',
    category: 'founder',
    color: '#06b6d4', // cyan
    glyph: '⚡',
  },
  {
    id: 'founder-pick',
    label: "Founder's Pick",
    description: 'Drawn from the beat-the-founder pool — straight to finals.',
    criteria: 'Be randomly selected from the Founder draw',
    category: 'founder',
    color: '#06b6d4',
    glyph: '🎟️',
  },
];

/** Lookup helper used by the catalog UI and the seed function. */
export const BADGE_BY_ID: Record<string, Badge> = Object.fromEntries(
  BADGE_CATALOG.map(b => [b.id, b]),
);

/** Initial UserBadge docs seeded into a new user — every badge starts locked. */
export function seedUserBadges(): { id: string; unlocked: false }[] {
  return BADGE_CATALOG.map(b => ({ id: b.id, unlocked: false as const }));
}
