import type { Badge } from '@/types';

/**
 * Single source of truth for all badges. Same pattern as the promo seed
 * list — ordered as displayed in the catalog grid. Adding a badge here +
 * deploying is sufficient for new users to see it; existing users get the
 * lazy-backfill on their next /api/badges read.
 *
 * Visual design rules:
 *  - Every badge has a unique glyph + color combo (no two look the same).
 *  - Champion-tier badges (BBB Champion, HOF Champion, Founder's Pick)
 *    get pulse + double-ring + gradient.
 *  - HOF podium uses gold ring overlay so it reads distinct from BBB
 *    podium even though the medal glyphs match.
 *  - Rare/special badges (drafts-100, beat-founder) get gradient fills.
 */
export const BADGE_CATALOG: Badge[] = [
  // ── Drafts ───────────────────────────────────────────────────────────
  {
    id: 'first-draft',
    label: 'First Draft',
    description: 'Completed your first draft. Welcome to SBS.',
    criteria: 'Complete 1 draft',
    category: 'drafts',
    color: '#84cc16', // lime — fresh start
    glyph: '🌱',
  },
  {
    id: 'drafts-20',
    label: 'Veteran',
    description: '20 drafts deep. You know the lobby by heart.',
    criteria: 'Complete 20 drafts',
    category: 'drafts',
    color: '#3b82f6', // blue
    accentColor: '#1e40af',
    gradient: true,
    glyph: '⚔️',
  },
  {
    id: 'drafts-50',
    label: 'Grinder',
    description: '50 drafts in. The grind is paying off.',
    criteria: 'Complete 50 drafts',
    category: 'drafts',
    color: '#6366f1', // indigo — between blue Veteran and purple Centurion
    accentColor: '#8b5cf6', // violet
    gradient: true,
    glyph: '🎖️',
  },
  {
    id: 'drafts-100',
    label: 'Centurion',
    description: '100 drafts. Certified degenerate.',
    criteria: 'Complete 100 drafts',
    category: 'drafts',
    color: '#a855f7', // purple
    accentColor: '#ec4899', // pink
    gradient: true,
    ringStyle: 'double',
    glow: 'pulse',
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
    accentColor: '#fbbf24', // gold accent (jp bling)
    gradient: true,
    glyph: '💰',
  },
  {
    id: 'league-winner-hof',
    label: 'HOF League Winner',
    description: '1st place in your HOF draft pod — into the HOF playoffs.',
    criteria: 'Finish 1st in a HOF league regular season',
    category: 'league',
    color: '#D4AF37', // hof gold
    ringStyle: 'double',
    glyph: '🏛️',
  },
  {
    id: 'made-playoffs',
    label: 'Playoff Bound',
    description: 'Top 2 in your league regular season — made the playoffs.',
    criteria: 'Finish top 2 in any league regular season',
    category: 'league',
    color: '#22c55e', // green
    glyph: '🏈',
  },
  {
    id: 'week-winner',
    label: 'Week Champion',
    description: 'Highest-scoring team across the entire contest in a single week.',
    criteria: 'Finish #1 overall in any week (1–14)',
    category: 'league',
    color: '#fbbf24', // banana yellow
    accentColor: '#fb923c', // orange — separates from league-pod wins
    gradient: true,
    glow: 'soft',
    glyph: '🔥',
  },

  // ── Finals (BBB main bracket) ────────────────────────────────────────
  {
    id: 'made-finals',
    label: 'Finalist',
    description: 'Reached the week-17 finals. The big stage.',
    criteria: 'Reach the BBB finals',
    category: 'finals',
    color: '#facc15', // yellow
    glow: 'soft',
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
    color: '#ffd700',
    accentColor: '#fb923c', // amber
    gradient: true,
    ringStyle: 'rainbow',
    glow: 'pulse',
    glyph: '🏆',
  },

  // ── HOF playoffs (weeks 15–17 cumulative) ────────────────────────────
  // Same medal glyphs as BBB podium, but with a gold ring overlay so
  // viewers can distinguish "HOF bronze" from "BBB bronze" at a glance.
  {
    id: 'hof-bronze',
    label: 'HOF Bronze',
    description: '3rd place in HOF playoffs.',
    criteria: 'Finish 3rd in the HOF playoff bracket',
    category: 'finals',
    color: '#cd7f32',
    ringColor: '#D4AF37', // gold ring marks it HOF
    ringStyle: 'double',
    glyph: '🥉',
  },
  {
    id: 'hof-silver',
    label: 'HOF Silver',
    description: '2nd place in HOF playoffs.',
    criteria: 'Finish 2nd in the HOF playoff bracket',
    category: 'finals',
    color: '#c0c0c0',
    ringColor: '#D4AF37',
    ringStyle: 'double',
    glyph: '🥈',
  },
  {
    id: 'hof-champion',
    label: 'HOF Champion',
    description: 'Won the HOF playoffs. Untouchable.',
    criteria: 'Win the HOF playoff bracket',
    category: 'finals',
    color: '#D4AF37',
    accentColor: '#fde68a',
    gradient: true,
    ringStyle: 'double',
    glow: 'pulse',
    glyph: '🌟',
  },

  // ── Wheel ────────────────────────────────────────────────────────────
  {
    id: 'first-spin',
    label: 'First Spin',
    description: 'Spun the wheel for the first time.',
    criteria: 'Spin the wheel once',
    category: 'wheel',
    color: '#94a3b8', // slate
    glyph: '🎡',
  },
  {
    id: 'spin-jackpot',
    label: 'Lucky Spin (JP)',
    description: 'Hit Jackpot on the wheel.',
    criteria: 'Land on Jackpot on a wheel spin',
    category: 'wheel',
    color: '#ef4444',
    glow: 'soft',
    glyph: '🎰',
  },
  {
    id: 'spin-hof',
    label: 'Lucky Spin (HOF)',
    description: 'Hit HOF on the wheel.',
    criteria: 'Land on HOF on a wheel spin',
    category: 'wheel',
    color: '#D4AF37',
    glow: 'soft',
    glyph: '🪙', // coin — distinct from slot machine
  },

  // ── Founder ──────────────────────────────────────────────────────────
  {
    id: 'beat-founder',
    label: 'Beat the Founder',
    description: 'Outscored the founder in your Founder league, weeks 1–14.',
    criteria: 'Score more than the founder in a Founder league regular season',
    category: 'founder',
    color: '#06b6d4', // cyan
    accentColor: '#7dd3fc', // light cyan
    gradient: true,
    glyph: '⚡',
  },
  {
    id: 'founder-pick',
    label: "Founder's Pick",
    description: 'Drawn from the beat-the-founder pool — straight to finals.',
    criteria: 'Be randomly selected from the Founder draw',
    category: 'founder',
    color: '#06b6d4',
    accentColor: '#fbbf24', // cyan + gold = lucky pick
    gradient: true,
    ringStyle: 'double',
    glow: 'pulse',
    glyph: '🎟️',
  },

  // ── Season participation ─────────────────────────────────────────────
  // BBB4 is the current season — earned by anyone who owns a BBB4 pass,
  // visible/unlockable as you go. BBB1/2/3 are retroactive — hidden until
  // admin-granted based on on-chain holders of those past collections.
  {
    id: 'bbb4-participant',
    label: 'BBB4 Participant',
    description: 'Held a Banana Best Ball Season 4 draft pass.',
    criteria: 'Own a BBB4 draft pass',
    category: 'legacy',
    color: '#fbbf24',         // banana yellow → orange — current season pops
    accentColor: '#f97316',
    gradient: true,
    ringStyle: 'double',
    glow: 'pulse',            // pulse marks it as the live/active season
    glyph: 'BBB4',
  },
  {
    id: 'bbb1-participant',
    label: 'BBB1 Participant',
    description: 'Held a Banana Best Ball Season 1 draft pass.',
    criteria: 'Past-season participant',
    category: 'legacy',
    color: '#22c55e',         // emerald → forest, OG roots
    accentColor: '#0f5132',
    gradient: true,
    ringStyle: 'double',
    glow: 'soft',
    glyph: 'BBB1',
    hidden: true,
  },
  {
    id: 'bbb2-participant',
    label: 'BBB2 Participant',
    description: 'Held a Banana Best Ball Season 2 draft pass.',
    criteria: 'Past-season participant',
    category: 'legacy',
    color: '#3b82f6',         // blue → deep navy
    accentColor: '#1e3a8a',
    gradient: true,
    ringStyle: 'double',
    glow: 'soft',
    glyph: 'BBB2',
    hidden: true,
  },
  {
    id: 'bbb3-participant',
    label: 'BBB3 Participant',
    description: 'Held a Banana Best Ball Season 3 draft pass.',
    criteria: 'Past-season participant',
    category: 'legacy',
    color: '#ec4899',         // pink → deep magenta
    accentColor: '#831843',
    gradient: true,
    ringStyle: 'double',
    glow: 'soft',
    glyph: 'BBB3',
    hidden: true,
  },

  // ── Legacy / past-season champions (HIDDEN until unlocked) ────────────
  // These never show in the catalog while locked — they only appear on a
  // user's profile once admin-awarded. Cosmetic-only proof that someone
  // won a previous BBB season or its HOF bracket.
  {
    id: 'bbb1-champion',
    label: 'BBB1 Champion',
    description: 'Won Banana Best Ball Season 1.',
    criteria: 'Past-season champion',
    category: 'legacy',
    color: '#ffd700',
    accentColor: '#22c55e', // S1 emerald flair
    gradient: true,
    ringStyle: 'rainbow',
    glow: 'pulse',
    glyph: '①',
    hidden: true,
  },
  {
    id: 'bbb1-hof-champion',
    label: 'BBB1 HOF Champion',
    description: 'Won the BBB Season 1 HOF bracket.',
    criteria: 'Past-season HOF champion',
    category: 'legacy',
    color: '#D4AF37',
    accentColor: '#22c55e',
    gradient: true,
    ringStyle: 'double',
    ringColor: '#22c55e',
    glow: 'pulse',
    glyph: '①',
    hidden: true,
  },
  {
    id: 'bbb2-champion',
    label: 'BBB2 Champion',
    description: 'Won Banana Best Ball Season 2.',
    criteria: 'Past-season champion',
    category: 'legacy',
    color: '#ffd700',
    accentColor: '#3b82f6', // S2 blue flair
    gradient: true,
    ringStyle: 'rainbow',
    glow: 'pulse',
    glyph: '②',
    hidden: true,
  },
  {
    id: 'bbb2-hof-champion',
    label: 'BBB2 HOF Champion',
    description: 'Won the BBB Season 2 HOF bracket.',
    criteria: 'Past-season HOF champion',
    category: 'legacy',
    color: '#D4AF37',
    accentColor: '#3b82f6',
    gradient: true,
    ringStyle: 'double',
    ringColor: '#3b82f6',
    glow: 'pulse',
    glyph: '②',
    hidden: true,
  },
  {
    id: 'bbb3-champion',
    label: 'BBB3 Champion',
    description: 'Won Banana Best Ball Season 3.',
    criteria: 'Past-season champion',
    category: 'legacy',
    color: '#ffd700',
    accentColor: '#ec4899', // S3 pink flair
    gradient: true,
    ringStyle: 'rainbow',
    glow: 'pulse',
    glyph: '③',
    hidden: true,
  },
  {
    id: 'bbb3-hof-champion',
    label: 'BBB3 HOF Champion',
    description: 'Won the BBB Season 3 HOF bracket.',
    criteria: 'Past-season HOF champion',
    category: 'legacy',
    color: '#D4AF37',
    accentColor: '#ec4899',
    gradient: true,
    ringStyle: 'double',
    ringColor: '#ec4899',
    glow: 'pulse',
    glyph: '③',
    hidden: true,
  },

  // ── NFL team flair ───────────────────────────────────────────────────
  // Cosmetic only. Available to everyone immediately — no unlock criteria.
  // Glyph is the team's 3-letter code; color is the team's primary brand
  // color so the disc reads as that team at a glance.
  ...([
    ['team-ari', 'Cardinals', 'ARI', '#97233F'],
    ['team-atl', 'Falcons', 'ATL', '#A71930'],
    ['team-bal', 'Ravens', 'BAL', '#241773'],
    ['team-buf', 'Bills', 'BUF', '#00338D'],
    ['team-car', 'Panthers', 'CAR', '#0085CA'],
    ['team-chi', 'Bears', 'CHI', '#0B162A'],
    ['team-cin', 'Bengals', 'CIN', '#FB4F14'],
    ['team-cle', 'Browns', 'CLE', '#311D00'],
    ['team-dal', 'Cowboys', 'DAL', '#003594'],
    ['team-den', 'Broncos', 'DEN', '#FB4F14'],
    ['team-det', 'Lions', 'DET', '#0076B6'],
    ['team-gb', 'Packers', 'GB', '#203731'],
    ['team-hou', 'Texans', 'HOU', '#03202F'],
    ['team-ind', 'Colts', 'IND', '#002C5F'],
    ['team-jax', 'Jaguars', 'JAX', '#006778'],
    ['team-kc', 'Chiefs', 'KC', '#E31837'],
    ['team-lac', 'Chargers', 'LAC', '#0080C6'],
    ['team-lar', 'Rams', 'LAR', '#003594'],
    ['team-lv', 'Raiders', 'LV', '#000000'],
    ['team-mia', 'Dolphins', 'MIA', '#008E97'],
    ['team-min', 'Vikings', 'MIN', '#4F2683'],
    ['team-ne', 'Patriots', 'NE', '#002244'],
    ['team-no', 'Saints', 'NO', '#9F8958'],
    ['team-nyg', 'Giants', 'NYG', '#0B2265'],
    ['team-nyj', 'Jets', 'NYJ', '#125740'],
    ['team-phi', 'Eagles', 'PHI', '#004C54'],
    ['team-pit', 'Steelers', 'PIT', '#FFB612'],
    ['team-sea', 'Seahawks', 'SEA', '#002244'],
    ['team-sf', '49ers', 'SF', '#AA0000'],
    ['team-tb', 'Buccaneers', 'TB', '#D50A0A'],
    ['team-ten', 'Titans', 'TEN', '#0C2340'],
    ['team-was', 'Commanders', 'WAS', '#5A1414'],
  ] as const).map(([id, name, code, color]): Badge => ({
    id,
    label: name,
    description: `${name} fan flair.`,
    criteria: 'Always available — pick your team',
    category: 'team',
    color,
    glyph: code, // fallback if image fails to load
    iconUrl: `https://a.espncdn.com/i/teamlogos/nfl/500/${code.toLowerCase()}.png`,
    alwaysUnlocked: true,
  })),
];

/** Lookup helper used by the catalog UI and the seed function. */
export const BADGE_BY_ID: Record<string, Badge> = Object.fromEntries(
  BADGE_CATALOG.map(b => [b.id, b]),
);

/** Initial UserBadge docs seeded into a new user — every badge starts locked.
 *  Skips alwaysUnlocked cosmetics (NFL team flair) since their unlock state
 *  is implicit in the catalog and doesn't need a per-user Firestore doc. */
export function seedUserBadges(): { id: string; unlocked: false }[] {
  return BADGE_CATALOG
    .filter(b => !b.alwaysUnlocked)
    .map(b => ({ id: b.id, unlocked: false as const }));
}
