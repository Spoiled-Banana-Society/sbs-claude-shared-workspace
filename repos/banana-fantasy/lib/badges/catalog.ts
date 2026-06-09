import type { Badge } from '@/types';
import { RIPENESS_TIERS, ripenessBadgeId } from './ripeness';

/**
 * Single source of truth for all badges — the "obsidian disc" set.
 *
 * Every badge renders as a dark-glass disc with a solid colored rim and a
 * flat center icon (NO glow). The renderer (components/badges/BadgeIcon.tsx)
 * switches on `contentKind`; the catalog just declares colors + content.
 * Designs/colors are locked to ~/Desktop/badges-each.html.
 *
 * The set, in catalog order:
 *  - Ripeness — ONE dynamic banana everyone carries; its fill color comes
 *    from how many paid BBB4 passes they've bought (lib/badges/ripeness.ts).
 *    Never "unlocked"; always the default badge unless they equip another.
 *  - Championships — BBB Champion I–III (blue), HOF Champion I–IV (gold).
 *  - Clubs — Jackpot Club (red), HOF Club (gold).
 *  - Status — King of Drafts (purple, transient/weekly), Founders, OG.
 *  - Team flair — 32 NFL logos, always available (cosmetic).
 *
 * Adding a badge here + deploying is enough for new users; existing users
 * get the lazy-backfill on their next /api/badges read.
 */

const RIM_GREY = '#48484f';

// Champion badges per season. Roman numeral is shown on the disc; the season
// number drives the id + copy. BBB = blue, HOF = gold.
const BBB_SEASONS: Array<[num: number, roman: string]> = [
  [1, 'I'], [2, 'II'], [3, 'III'], [4, 'IV'],
];
const HOF_SEASONS: Array<[num: number, roman: string]> = [
  [1, 'I'], [2, 'II'], [3, 'III'], [4, 'IV'],
];

export const BADGE_CATALOG: Badge[] = [
  // ── Your Banana (6 ripeness tiers — unlock by buying PAID BBB4 drafts) ─
  // Each tier is a real, equippable badge: grey/locked until you cross its
  // paid-pass threshold, then it turns its tier color and you can equip it.
  // Unripe is everyone's starting banana (always unlocked).
  ...RIPENESS_TIERS.map((t): Badge => ({
    id: ripenessBadgeId(t.key),
    label: t.label,
    description: `Your banana is ${t.label} — ${t.range} paid drafts done in BBB4.`,
    criteria: t.min <= 0
      ? 'Your starting banana — everyone has one'
      : `Do ${t.min}+ paid BBB4 drafts`,
    category: 'ripeness',
    contentKind: 'banana',
    contentColor: t.color, // the banana fills with this when unlocked
    rimColor: t.rim ?? RIM_GREY, // Spoiled gets a gold frame; rest grey
    color: t.color,
    glyph: '🍌',
    // Unripe is the floor everyone carries; the rest unlock by buying.
    ...(t.min <= 0 ? { alwaysUnlocked: true } : {}),
  })),

  // ── Championships ────────────────────────────────────────────────────
  // Hidden while locked: these are winner-only trophies (snapshot/admin
  // grant). Non-winners can't earn them, so they don't show as locked teasers
  // — they only appear in the catalog of the champions who hold them.
  ...BBB_SEASONS.map(([num, roman]): Badge => ({
    id: `bbb-champion-${num}`,
    label: `BBB ${roman} Champion`,
    description: `BBB Season ${num} Champion`,
    criteria: 'Win a BBB season final',
    category: 'championship',
    contentKind: 'numeral-crown',
    numeral: roman,
    rimColor: '#3b82f6',
    contentColor: '#9dc1fb',
    color: '#3b82f6',
    glyph: '👑',
    hidden: true,
  })),
  ...HOF_SEASONS.map(([num, roman]): Badge => ({
    id: `hof-champion-${num}`,
    label: `HOF ${roman} Champion`,
    description: `HOF Season ${num} Champion`,
    criteria: 'Win a HOF bracket',
    category: 'championship',
    contentKind: 'hof-champ',
    numeral: roman,
    rimColor: '#cca54f',
    contentColor: '#f7e6ad',
    color: '#cca54f',
    glyph: '🏆',
    hidden: true,
  })),

  // ── Clubs ────────────────────────────────────────────────────────────
  {
    id: 'jackpot-club',
    label: 'Jackpot Club',
    description: "Jackpot Club — you've entered a Jackpot draft",
    criteria: 'Enter a Jackpot draft (or win Jackpot on the wheel)',
    category: 'club',
    contentKind: 'text',
    text: 'JP',
    rimColor: '#b5453f',
    contentColor: '#daa29f',
    color: '#b5453f',
    glyph: '🎰',
  },
  {
    id: 'hof-club',
    label: 'HOF Club',
    description: "HOF Club — you've entered a Hall of Fame draft",
    criteria: 'Enter a HOF draft (or win HOF on the wheel)',
    category: 'club',
    contentKind: 'text',
    text: 'HOF',
    rimColor: '#cca54f',
    contentColor: '#f7e6ad',
    color: '#cca54f',
    glyph: '🏛️',
  },

  // ── Status ───────────────────────────────────────────────────────────
  {
    id: 'king-of-drafts',
    label: 'King of Drafts',
    description: 'King of Drafts — most paid drafts last week',
    criteria: 'Enter the most paid drafts of anyone in a week',
    category: 'status',
    contentKind: 'icon',
    iconName: 'crown',
    rimColor: '#8b5cf6',
    contentColor: '#c5aefb',
    color: '#8b5cf6',
    glyph: '👑',
  },
  {
    id: 'founders-league',
    label: 'Founders League',
    description: 'Founders League — you played in a founders league',
    criteria: 'Play in a Founders league',
    category: 'status',
    contentKind: 'icon',
    iconName: 'key',
    rimColor: RIM_GREY,
    contentColor: '#f3f5f8',
    color: RIM_GREY,
    glyph: '🔑',
  },
  {
    id: 'og',
    label: 'OG',
    description: 'OG — played a past Banana Best Ball season (BBB1, 2 or 3)',
    criteria: 'Played a past Banana Best Ball season (BBB1–3)',
    category: 'status',
    contentKind: 'text',
    text: 'OG',
    rimColor: RIM_GREY,
    contentColor: '#f3f5f8',
    color: RIM_GREY,
    glyph: '⭐',
    // Hidden while locked: you either ARE an OG (past-season player) or you
    // aren't — it can't be earned this season, so no locked teaser.
    hidden: true,
  },

  // ── NFL team flair ───────────────────────────────────────────────────
  // Cosmetic only. Available to everyone immediately — no unlock criteria.
  // The disc keeps the grey rim; the team's full-color logo fills the center.
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
    description: `${name} fan`,
    criteria: 'Always available — pick your team',
    category: 'team',
    contentKind: 'logo',
    rimColor: RIM_GREY,
    color, // team brand color (back-compat; rim stays grey)
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
 *  Skips alwaysUnlocked cosmetics (NFL team flair) and dynamic badges
 *  (ripeness — always present, never a Firestore unlock) since their state
 *  isn't a per-user locked doc. */
export function seedUserBadges(): { id: string; unlocked: false }[] {
  return BADGE_CATALOG
    .filter(b => !b.alwaysUnlocked && !b.dynamic)
    .map(b => ({ id: b.id, unlocked: false as const }));
}
