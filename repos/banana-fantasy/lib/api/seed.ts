import type {
  CompletedDraft,
  Contest,
  LeaderboardEntry,
  Promo,
  User,
  UserExposure,
  WheelSpin,
} from '@/types';
import type { DbSchema } from './dbTypes';
import { API_CONFIG } from './config';

const seedUser1: User = {
  id: '1',
  username: 'BananaKing99',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678', // Mock test wallet address
  loginMethod: 'social',
  profilePicture: undefined,
  nflTeam: 'Chiefs',
  xHandle: '@BananaKing99',
  draftPasses: 0,
  usdcBalance: 0,
  freeDrafts: 0,
  wheelSpins: 2,
  jackpotEntries: 0,
  hofEntries: 0,
  cardPurchaseCount: 0,
  isVerified: true,
  createdAt: '2025-09-01',
};

const seedContests: Contest[] = [
  {
    id: '1',
    name: 'Banana Best Ball IV',
    type: 'regular',
    prizePool: 100000,
    topPrize: 25000,
    entryFee: 25,
    jpPercent: 42,
    hofPercent: 67,
    jpHits: 0,
    hofHits: 2,
    maxEntries: 5000,
    currentEntries: 3240,
    startDate: '2026-01-20',
    endDate: '2026-02-10',
    status: 'upcoming',
    rosterFormat: [
      { position: 'QB', count: 1 },
      { position: 'RB', count: 2 },
      { position: 'WR', count: 3 },
      { position: 'TE', count: 1 },
      { position: 'FLEX', count: 2 },
      { position: 'K', count: 1 },
      { position: 'DEF', count: 1 },
    ],
    scoringRules: [
      { category: 'Passing', action: 'Passing TD', points: 4 },
      { category: 'Passing', action: 'Passing Yard', points: 0.04 },
      { category: 'Passing', action: 'Interception', points: -1 },
      { category: 'Rushing', action: 'Rushing TD', points: 6 },
      { category: 'Rushing', action: 'Rushing Yard', points: 0.1 },
      { category: 'Receiving', action: 'Receiving TD', points: 6 },
      { category: 'Receiving', action: 'Receiving Yard', points: 0.1 },
      { category: 'Receiving', action: 'Reception', points: 0.5 },
    ],
    prizeBreakdown: [
      { place: '1st', amount: 25000 },
      { place: '2nd', amount: 15000 },
      { place: '3rd', amount: 10000 },
      { place: '4th-10th', amount: 5000 },
      { place: '11th-50th', amount: 500 },
    ],
  },
  {
    id: '2',
    name: 'Weekly Showdown',
    type: 'jackpot',
    prizePool: 50000,
    topPrize: 15000,
    entryFee: 10,
    jpPercent: 85,
    hofPercent: 45,
    jpHits: 1,
    hofHits: 4,
    maxEntries: 10000,
    currentEntries: 7820,
    startDate: '2026-01-18',
    endDate: '2026-01-19',
    status: 'upcoming',
    rosterFormat: [
      { position: 'QB', count: 1 },
      { position: 'RB', count: 2 },
      { position: 'WR', count: 2 },
      { position: 'TE', count: 1 },
      { position: 'FLEX', count: 1 },
    ],
    scoringRules: [
      { category: 'Passing', action: 'Passing TD', points: 4 },
      { category: 'Passing', action: 'Passing Yard', points: 0.04 },
      { category: 'Rushing', action: 'Rushing TD', points: 6 },
      { category: 'Rushing', action: 'Rushing Yard', points: 0.1 },
      { category: 'Receiving', action: 'Receiving TD', points: 6 },
      { category: 'Receiving', action: 'Receiving Yard', points: 0.1 },
    ],
    prizeBreakdown: [
      { place: '1st', amount: 15000 },
      { place: '2nd', amount: 7500 },
      { place: '3rd', amount: 5000 },
    ],
  },
];

const seedLeaderboard: LeaderboardEntry[] = [
  { rank: 1, username: 'FantasyGOAT', teamName: 'Dream Team', seasonScore: 892, weeklyScore: 245 },
  { rank: 2, username: 'ChampionDrafter', teamName: 'Elite Squad', seasonScore: 856, weeklyScore: 232 },
  { rank: 3, username: 'BananaKing99', teamName: 'BBB 3 League #1042', seasonScore: 706, weeklyScore: 196, isCurrentUser: true },
  { rank: 4, username: 'GridironGuru', teamName: 'Iron Giants', seasonScore: 698, weeklyScore: 188 },
  { rank: 5, username: 'DraftMaster', teamName: 'Master Drafters', seasonScore: 685, weeklyScore: 176 },
  { rank: 6, username: 'NFLNinja', teamName: 'Ninja Squad', seasonScore: 672, weeklyScore: 185 },
  { rank: 7, username: 'TouchdownKing', teamName: 'TD Machines', seasonScore: 658, weeklyScore: 168 },
  { rank: 8, username: 'BananaFan1', teamName: 'Banana Bunch', seasonScore: 645, weeklyScore: 172 },
  { rank: 9, username: 'ProPicker', teamName: 'Pro Picks', seasonScore: 632, weeklyScore: 165 },
  { rank: 10, username: 'FantasyAce', teamName: 'Ace Team', seasonScore: 618, weeklyScore: 158 },
];

const seedWheelHistory: WheelSpin[] = [
  { id: '1', date: '2026-01-15', prize: { type: 'drafts', amount: 5 }, claimed: true },
  { id: '2', date: '2026-01-12', prize: { type: 'drafts', amount: 1 }, claimed: true },
  { id: '3', date: '2026-01-10', prize: { type: 'jackpot' }, claimed: true },
  { id: '4', date: '2026-01-08', prize: { type: 'drafts', amount: 10 }, claimed: true },
  { id: '5', date: '2026-01-05', prize: { type: 'hof' }, claimed: true },
];

const seedDraftHistory: CompletedDraft[] = [
  {
    id: 'c1',
    contestName: 'League #892',
    type: 'jackpot',
    finalPlace: 1,
    totalPlayers: 10,
    score: 245.8,
    prizeWon: 2500,
    completedDate: '2026-01-20',
    draftSpeed: 'fast',
    topPlayers: [
      { position: 'QB', team: 'KC', points: 32.5 },
      { position: 'RB', team: 'SF', points: 28.2 },
      { position: 'WR', team: 'MIA', points: 26.8 },
    ],
  },
  {
    id: 'c2',
    contestName: 'League #756',
    type: 'hof',
    finalPlace: 2,
    totalPlayers: 10,
    score: 218.4,
    prizeWon: 750,
    completedDate: '2026-01-19',
    draftSpeed: 'slow',
    topPlayers: [
      { position: 'WR', team: 'MIN', points: 29.1 },
      { position: 'TE', team: 'KC', points: 24.6 },
      { position: 'RB', team: 'BAL', points: 22.3 },
    ],
  },
  {
    id: 'c3',
    contestName: 'League #621',
    type: 'regular',
    finalPlace: 3,
    totalPlayers: 10,
    score: 201.2,
    prizeWon: 150,
    completedDate: '2026-01-18',
    draftSpeed: 'fast',
    topPlayers: [
      { position: 'QB', team: 'BUF', points: 27.8 },
      { position: 'WR', team: 'CIN', points: 25.4 },
      { position: 'RB', team: 'MIA', points: 21.9 },
    ],
  },
];

const seedExposure: UserExposure = {
  username: 'BananaKing99',
  totalDrafts: 20,
  exposures: [
    { team: 'KC', position: 'QB', teamPosition: 'KC QB', drafts: 7, totalDrafts: 20, exposure: 35 },
    { team: 'PHI', position: 'QB', teamPosition: 'PHI QB', drafts: 5, totalDrafts: 20, exposure: 25 },
    { team: 'BUF', position: 'QB', teamPosition: 'BUF QB', drafts: 4, totalDrafts: 20, exposure: 20 },
    { team: 'MIA', position: 'WR1', teamPosition: 'MIA WR1', drafts: 6, totalDrafts: 20, exposure: 30 },
    { team: 'SF', position: 'RB1', teamPosition: 'SF RB1', drafts: 6, totalDrafts: 20, exposure: 30 },
    { team: 'KC', position: 'TE', teamPosition: 'KC TE', drafts: 8, totalDrafts: 20, exposure: 40 },
    { team: 'SF', position: 'DST', teamPosition: 'SF DST', drafts: 6, totalDrafts: 20, exposure: 30 },
  ],
};

const seedPromos: Promo[] = [
  {
    id: '2',
    type: 'pick-10',
    title: 'Pick 10 → FREE SPIN',
    description: 'Get the 10th pick for a spin',
    ctaText: 'Draft Now',
    ctaLink: '/drafting',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 1,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Get Pick 10 Get a SPIN',
      explanation:
        'When you get the 10th pick in any draft you earn a free Banana Wheel spin. This can happen multiple times - each Pick 10 earns you a spin!',
      totalPick10s: 8,
      pick10History: [
        { date: '2026-01-15', draftName: 'League #1042', status: 'claim' },
        { date: '2026-01-14', draftName: 'League #892', status: 'claim' },
        { date: '2026-01-12', draftName: 'League #756', status: 'claimed' },
      ],
    },
  },
  {
    id: '3',
    type: 'referral',
    title: 'Refer Friend → FREE SPIN',
    description: 'Invite friends both get a spin',
    ctaText: 'Invite Now',
    ctaLink: '#',
    backgroundColor: '#2a2a35',
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Refer a Friend Get a Free SPIN',
      explanation:
        'Share your unique referral link with friends. Your friend must:\n\n1) Verify their X account\n2) Claim and use their Free Spin on the prize wheel\n\nEarn bonus spins when they purchase draft passes.',
      additionalRules:
        'Referred users must participate in fantasy football to qualify. Banana Fantasy reserves the right to revoke draft passes or drafted teams from users found to be abusing this promotion.',
      inviteCode: 'BANANA-CK99-2026',
      referralLink: 'https://banana-fantasy-sbs.vercel.app?ref=BANANA-CK99-2026',
      referralRewards: [
        { milestone: 'Friend Verifies & Claims Free Spin', reward: '1 Free Spin' },
        { milestone: 'Friend buys 1 draft', reward: '1 Free Spin' },
        { milestone: 'Friend buys 10 drafts', reward: '1 Free Spin' },
      ],
      referralHistory: [],
    },
  },
  {
    id: '8',
    type: 'tweet-engagement',
    title: 'Tweet Engagement → FREE SPIN',
    description: 'Reply & QRT to earn a spin',
    ctaText: 'Engage Now',
    ctaLink: API_CONFIG.promos.tweetEngagement.tweetUrl,
    backgroundColor: '#2a2a35',
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Tweet Engagement Rewards',
      explanation:
        'Engage with the SBS launch tweet (like, repost, or meaningful reply) to earn a Banana Wheel spin. Claims are one-time per campaign and reviewed for abuse prevention.',
      additionalRules: 'One reward per user per campaign. Low-quality spam engagement may be denied.',
      twitterConnected: false,
    },
  },
  {
    id: '6',
    type: 'new-user',
    title: 'New User → FREE SPIN',
    description: 'Connect Twitter to claim',
    ctaText: 'Verify',
    ctaLink: '#',
    backgroundColor: '#2a2a35',
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'New User Bonus SPIN',
      explanation:
        'Verify your account by connecting your Twitter/X to claim your welcome spin. This helps us ensure fair play for everyone.',
      twitterConnected: false,
    },
  },
  {
    id: '1',
    type: 'daily-drafts',
    title: '4 Drafts Daily → FREE SPIN',
    description: 'Complete 4 drafts today for a spin',
    ctaText: 'Start Drafting',
    ctaLink: '/drafting',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 4,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: '4 Drafts Daily → FREE SPIN',
      explanation:
        'Complete 4 drafts within 24 hours to earn a free Banana Wheel spin. Your 24-hour timer starts when you begin your first draft. Once you complete 4 drafts, your progress and timer reset so you can earn another spin!',
    },
  },
  {
    id: '5',
    type: 'mint',
    title: 'Buy 10 → FREE SPIN',
    description: 'Buy 10 passes for a spin',
    ctaText: 'Buy Drafts',
    ctaLink: '/buy-drafts',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 10,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Buy 10 → FREE SPIN',
      explanation:
        'Purchase 10 draft passes to earn a Banana Wheel spin. This keeps stacking - buy 20 passes and get 2 spins or 30 passes for 3 spins and so on!',
      totalMinted: 0,
    },
  },
  {
    id: '7',
    type: 'buy-bonus',
    title: 'Buy 2 → 1 Free',
    description: 'Limited time offer!',
    ctaText: 'Buy Now',
    ctaLink: '/buy-drafts',
    backgroundColor: '#2a2a35',
    isNew: true,
    claimable: false,
    claimCount: 0,
    progressCurrent: 0,
    progressMax: 2,
    modalContent: {
      title: 'Buy 2 → 1 Free Draft',
      explanation:
        'For a limited time purchase 2 draft passes and receive 1 additional free draft pass! This offer applies to every 2 passes purchased.',
    },
  },
  {
    id: '10',
    type: 'spin-share',
    title: 'Share Wins → FREE SPIN',
    description: 'Share 3 big wins on X for a spin',
    ctaText: 'Go Spin',
    ctaLink: '/banana-wheel',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 3,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Share Big Wins → FREE SPIN',
      explanation:
        'Share your Jackpot, HOF, or 5+ draft wins on X. Every 3 verified shares earns you a free Banana Wheel spin. Small wins can still be shared for bragging rights but don\'t count toward the free spin.',
      additionalRules:
        'You need to link your X account in your profile. After tweeting, it may take up to a minute for us to verify. Each spin can only be shared once.',
    },
  },
  {
    id: '4',
    type: 'jackpot',
    title: 'Jackpot Hit → FREE SPIN',
    description: 'Win a Jackpot draft for a bonus',
    ctaText: 'View Drafts',
    ctaLink: '/standings',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 1,
    modalContent: {
      title: 'Jackpot Hit → FREE SPIN',
      explanation:
        '• 1 Jackpot draft in every 100 drafts\n\n• Jackpot hit within first 25 drafts → 1 of the 10 drafters in the Jackpot draft wins 10 free spins\n\n• Jackpot hit within first 50 drafts → 1 of the 10 drafters in the Jackpot draft wins 5 free spins\n\n• Cycle resets after every 100 drafts\n\n• Jackpot League Perk: Win your Jackpot league and go straight to the finals, skipping the first two rounds of playoffs!',
      jackpotHistory: [],
    },
  },
  {
    id: 'pwa-install-promo',
    type: 'add-to-home-screen',
    title: 'Install SBS — Win 5 Free Spins',
    description: 'Add to your home screen within 48hrs. 1 random winner gets 5 free spins!',
    ctaText: 'Install',
    ctaLink: '#',
    backgroundColor: '#1a1a2e',
    claimable: false,
    isNew: true,
    timerEndTime: '',
    modalContent: {
      title: 'Install SBS — Win Free Spins',
      explanation:
        'Add Banana Fantasy to your home screen for a chance to win 5 free spins. 1 random winner chosen after the timer ends.',
    },
  },
];

export const seedDb: DbSchema = {
  users: { '1': seedUser1 },
  promosByUser: { '1': seedPromos },
  wheelSpinsByUser: { '1': seedWheelHistory },
  purchases: [],
  withdrawals: [],
  contests: seedContests,
  standingsByContestId: { '1': seedLeaderboard, '2': seedLeaderboard },
  exposureByUser: { '1': seedExposure },
  draftHistoryByUser: { '1': seedDraftHistory },
  referralsByUser: { '1': { code: 'BANANA-CK99-2026', createdAt: '2026-01-01' } },
};

/** Return default promo templates for logged-out users (no claim state). */
export function getDefaultPromos(): Promo[] {
  return seedPromos.map((p) => ({
    ...p,
    claimable: false,
    claimCount: 0,
  }));
}
