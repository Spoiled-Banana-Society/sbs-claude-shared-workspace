// Single source of truth for draft type colors and metadata
// Replaces 5+ inconsistent color definitions across the codebase

// 'jackhof' = Jackpot + HOF on the SAME draft (rolling-windows system) — both perks.
export type DraftType = 'jackpot' | 'hof' | 'pro' | 'jackhof';

// Drafting closes at NFL Season kickoff. Corrected 2026-09-04: the date was
// wrong (Sept 4 — it fired mid-day and blocked all joins). Real kickoff is
// Sept 9; pushed to a backstop PAST the 9th so it can't auto-close during the
// day's action. ⚠️ CLOSE IS MANUAL — Boris flips this to the real close moment
// when he says the word; the backstop only prevents a silent surprise.
export const DRAFTING_CLOSES_AT = new Date('2026-09-11T03:20:00Z');

export function isDraftingOpen(): boolean {
  return Date.now() < DRAFTING_CLOSES_AT.getTime();
}

// The season — and any real scoring (rank / weekly / season points) — begins at
// NFL kickoff, the same moment drafting closes. Before that there are no games,
// so any rank/score values on a pass are placeholder/seed data and must NOT be
// shown. Gate every score display on this. Self-resolves at kickoff; no flag flip.
export function hasSeasonStarted(): boolean {
  return Date.now() >= DRAFTING_CLOSES_AT.getTime();
}

export const DRAFT_TYPE_COLORS = {
  jackpot: {
    primary: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.3)',
    glowStrong: 'rgba(239, 68, 68, 0.6)',
    particleColors: ['#ef4444', '#f87171', '#fca5a5', '#fee2e2', '#ffffff'],
    label: 'JACKPOT',
    shortLabel: 'Jackpot',
    icon: '🔥',
    odds: '1%',
    perk: 'Skip to the Finals',
    perkDescription: 'Win your league and skip straight to the finals, bypassing 2 weeks of playoffs.',
    bgClass: 'bg-red-600',
    textClass: 'text-jackpot',
    badgeClass: 'badge-jackpot',
    glowClass: 'glow-jackpot',
  },
  hof: {
    primary: '#D4AF37',
    glow: 'rgba(212, 175, 55, 0.3)',
    glowStrong: 'rgba(212, 175, 55, 0.6)',
    particleColors: ['#D4AF37', '#fbbf24', '#fcd34d', '#fef3c7', '#ffffff'],
    label: 'HALL OF FAME',
    shortLabel: 'HOF',
    icon: '🏆',
    odds: '5%',
    perk: 'Bonus Prizes',
    perkDescription: 'Compete for additional prizes on top of regular weekly and season-long rewards.',
    bgClass: 'bg-yellow-600',
    textClass: 'text-hof',
    badgeClass: 'badge-hof',
    glowClass: 'glow-hof',
  },
  pro: {
    primary: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.3)',
    glowStrong: 'rgba(168, 85, 247, 0.6)',
    particleColors: ['#a855f7', '#c084fc', '#e879f9', '#f0abfc', '#ffffff'],
    label: 'PRO',
    shortLabel: 'Pro',
    icon: '⚡',
    odds: '94%',
    perk: 'Standard Draft',
    perkDescription: 'Standard competition draft.',
    bgClass: 'bg-purple-600',
    textClass: 'text-pro',
    badgeClass: 'badge-pro',
    glowClass: 'glow-pro',
  },
  jackhof: {
    primary: '#ef4444',
    glow: 'rgba(212, 175, 55, 0.3)',
    glowStrong: 'rgba(239, 68, 68, 0.6)',
    particleColors: ['#ef4444', '#f87171', '#D4AF37', '#fbbf24', '#ffffff'],
    label: 'JACKHOF',
    shortLabel: 'JackHOF',
    icon: '🔥',
    odds: '~0.1%',
    perk: 'Two Perks, One Draft',
    perkDescription: 'Jackpot + HOF landed on the same draft: win your league to skip straight to the finals, plus compete for HOF bonus prizes on top.',
    bgClass: 'bg-red-600',
    textClass: 'text-jackpot',
    badgeClass: 'badge-jackpot',
    glowClass: 'glow-jackpot',
  },
} as const;

// HOF logo filter CSS value
export const HOF_LOGO_FILTER = 'sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)';

// Helper functions
export function getDraftTypeColor(type: DraftType): string {
  return DRAFT_TYPE_COLORS[type].primary;
}

export function getDraftTypeGlow(type: DraftType): string {
  return DRAFT_TYPE_COLORS[type].glow;
}

export function getDraftTypeLabel(type: DraftType): string {
  return DRAFT_TYPE_COLORS[type].label;
}
