import type {
  CompletedDraft,
  Contest,
  LeaderboardEntry,
  Promo,
  User,
  UserBadge,
  UserExposure,
  WheelSpin,
} from '@/types';
import type { DbSchema } from './dbTypes';
import { API_CONFIG } from './config';
import { seedUserBadges } from '@/lib/badges/catalog';

const seedBadges: UserBadge[] = seedUserBadges();

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
  cardFeeCreditCents: 0,
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
    examplePaidDrafts: 5000,
    prizeBreakdown: [
      // Championship finals — $55,000
      { place: '1st', amount: 25000, section: 'Finals' },
      { place: '2nd', amount: 8000, section: 'Finals' },
      { place: '3rd', amount: 5000, section: 'Finals' },
      { place: '4th', amount: 3200, section: 'Finals' },
      { place: '5th', amount: 2400, section: 'Finals' },
      { place: '6th', amount: 1800, section: 'Finals' },
      { place: '7th', amount: 1400, section: 'Finals' },
      { place: '8th', amount: 1100, section: 'Finals' },
      { place: '9th', amount: 900, section: 'Finals' },
      { place: '10th', amount: 700, section: 'Finals' },
      { place: '11th–25th', amount: 200, note: 'each', section: 'Finals' },
      { place: '26th–50th', amount: 100, note: 'each', section: 'Finals' },
      // Per-league prizes — $40,000 (scale with number of leagues)
      { place: 'Regular-Season League Winner', amount: 20, note: 'each · 1,000 leagues', section: 'League Prizes' },
      { place: 'Playoff Round 1 Winner', amount: 20, note: 'each · 1,000 leagues', section: 'League Prizes' },
      // Hall of Fame track — $5,000
      { place: 'HOF 1st', amount: 3000, section: 'Hall of Fame' },
      { place: 'HOF 2nd', amount: 1200, section: 'Hall of Fame' },
      { place: 'HOF 3rd', amount: 800, section: 'Hall of Fame' },
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
        'For every 10th Slot Pick in a Draft you Hit you get a Free Banana Spin.\nPaid Drafts Only.',
      // Per-user state — starts empty. Real Pick 10s are appended by
      // recordPick10 on actual paid drafts. (Previously this carried 3 fake
      // demo rows incl. 2 'claim' entries, which were cloned into every real
      // user's doc and let them claim 2 spins they never earned.)
      totalPick10s: 0,
      pick10History: [],
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
        'Share your unique referral link with friends. Your friend must:\n\n1) Verify their X account\n2) Claim and use their Free Banana Spin on the prize wheel\n\nEarn bonus Free Banana Spins when they purchase draft passes.\n\nOne account per person — if you have more than one account you are not eligible to win prizes.',
      additionalRules:
        'Referred users must participate in fantasy football to qualify. Banana Fantasy reserves the right to revoke draft passes or drafted teams from users found to be abusing this promotion.',
      inviteCode: 'BANANA-CK99-2026',
      referralLink: 'https://banana-fantasy-sbs.vercel.app?ref=BANANA-CK99-2026',
      referralRewards: [
        { milestone: 'Friend Verifies & Claims Free Banana Spin', reward: '1 Free Banana Spin' },
        { milestone: 'Friend buys 1 draft', reward: '1 Free Banana Spin' },
        { milestone: 'Friend buys 10 drafts', reward: '1 Free Banana Spin' },
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
        'Engage with the SBS launch tweet (like, repost, or meaningful reply) to earn a Free Banana Spin. Claims are one-time per campaign and reviewed for abuse prevention.',
      additionalRules: 'One reward per user per campaign. Low-quality spam engagement may be denied.',
      twitterConnected: false,
    },
  },
  {
    id: '6',
    type: 'new-user',
    title: 'New User → FREE SPIN',
    description: 'Connect your X to claim your free spin',
    ctaText: 'Verify',
    ctaLink: '#',
    backgroundColor: '#2a2a35',
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'New User → FREE SPIN',
      explanation:
        'Verify your account by connecting your X to claim your Free Banana Spin.\n\nThen spin the Banana Wheel for a chance to win 20, 10, 5, or 1 Free Drafts — or a Jackpot/HOF draft.\n\nOne account per person — if you have more than one account you are not eligible to win prizes. This helps us ensure fair play for everyone.',
      additionalRules: '',
      twitterConnected: false,
    },
  },
  {
    id: '11',
    type: 'first-purchase',
    title: 'First Purchase → BONUS SPINS',
    description: 'Every 4 passes on your first buy = 1 spin',
    ctaText: 'Buy Drafts',
    ctaLink: '/buy-drafts',
    backgroundColor: '#2a2a35',
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'First Purchase → BONUS SPINS',
      explanation:
        'Your very first draft-pass purchase earns bonus Free Banana Spins — every 4 passes = 1 Free Banana Spin (buy 8 for 2, buy 12 for 3, and so on, no limit). One-time offer: it applies only to your first purchase, so buy them all in one transaction to lock in the most Spins. After you buy, claim your Spins right here.',
    },
  },
  {
    id: '1',
    type: 'daily-drafts',
    title: '4 Drafts Daily → FREE SPIN',
    description: 'Complete 4 paid drafts today for a spin',
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
        'Complete 4 paid drafts within 24 hours to earn a Free Banana Spin. Your 24-hour timer starts when your first paid draft fills. Once you complete 4, your progress and timer reset right away — there\'s no limit, every 4 paid drafts earns another Spin!\nPaid Drafts Only.',
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
      explanation: 'For every 10 drafts purchased, you get a Free Banana Spin.',
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
        'Share your Jackpot, HOF, or 5+ draft wins on X. Every 3 verified shares earns you a Free Banana Spin. Small wins can still be shared for bragging rights but don\'t count toward the Free Banana Spin.',
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
    ctaLink: '/my-teams',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 1,
    modalContent: {
      title: 'Jackpot Hit → FREE SPIN',
      explanation:
        '• 1 Jackpot draft in every 100 drafts\n\n• Jackpot hit within first 25 drafts → 1 of the 10 drafters in the Jackpot draft wins 10 Free Banana Spins\n\n• Jackpot hit within first 50 drafts → 1 of the 10 drafters in the Jackpot draft wins 5 Free Banana Spins\n\n• Cycle resets after every 100 drafts\n\n• Jackpot League Perk: Win your Jackpot league and go straight to the finals, skipping the first two rounds of playoffs!\n\n• Paid Drafts Only.',
      jackpotHistory: [],
    },
  },
  {
    id: 'founder-draft',
    type: 'founder-draft',
    title: 'Founder Draft → FREE SPIN',
    description: 'Join a draft with the founder for a free spin',
    ctaText: 'View Drafts',
    ctaLink: '/my-teams',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 1,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Founder Draft → FREE SPIN',
      explanation:
        '• Founder Draft happens every week at the same time\n\n• When the clock hits 0:00:00, click "Join Draft" the second it strikes\n\n• Multiple drafts fill in the rush — the one the founder lands in is the Founder Draft\n\n• Every drafter in the Founder Draft earns 1 Free Banana Spin to claim\n\n• Founder League Perk: Score more points than the founder in your Founder league → you\'re entered into a draw with everyone else who beat the founder across all Founder leagues. One person is randomly picked to skip straight to the finals!',
      founderHistory: [],
    },
  },
];

export const seedDb: DbSchema = {
  users: { '1': seedUser1 },
  promosByUser: { '1': seedPromos },
  wheelSpinsByUser: { '1': seedWheelHistory },
  badgesByUser: { '1': seedBadges },
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
