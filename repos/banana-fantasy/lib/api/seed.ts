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
      // Championship finals — $48,630
      { place: '1st', amount: 25000, section: 'Finals' },
      { place: '2nd', amount: 6000, section: 'Finals' },
      { place: '3rd', amount: 3500, section: 'Finals' },
      { place: '4th', amount: 2100, section: 'Finals' },
      { place: '5th', amount: 1600, section: 'Finals' },
      { place: '6th', amount: 1330, section: 'Finals' },
      { place: '7th', amount: 1130, section: 'Finals' },
      { place: '8th', amount: 960, section: 'Finals' },
      { place: '9th', amount: 810, section: 'Finals' },
      { place: '10th', amount: 700, section: 'Finals' },
      { place: '11th–25th', amount: 200, note: 'each', section: 'Finals' },
      { place: '26th–50th', amount: 100, note: 'each', section: 'Finals' },
      // Weekly prizes — top 5 each week, Weeks 1–14 (~$6,370 total, trimmed from 2nd–7th)
      { place: '1st', amount: 250, note: 'each week', section: 'Weekly (Weeks 1–14)' },
      { place: '2nd', amount: 100, note: 'each week', section: 'Weekly (Weeks 1–14)' },
      { place: '3rd', amount: 50, note: 'each week', section: 'Weekly (Weeks 1–14)' },
      { place: '4th', amount: 35, note: 'each week', section: 'Weekly (Weeks 1–14)' },
      { place: '5th', amount: 20, note: 'each week', section: 'Weekly (Weeks 1–14)' },
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
    title: 'Pick 6 & 10 → FREE SPINS',
    description: 'Every Spin wins up to 20 Free Drafts',
    ctaText: 'Draft Now',
    ctaLink: '/drafting',
    backgroundColor: '#2a2a35',
    // No NEW ribbon (Boris 2026-07-06 — Pick 6 & 10 is a standing promo, not new).
    // promoFilter also force-clears isNew for 'pick-10' so existing seeded docs
    // drop the ribbon too; keeping this false for freshly-seeded docs.
    isNew: false,
    progressCurrent: 0,
    progressMax: 1,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Pick 6 & 10 → Free Spins',
      explanation:
        '• Hit Pick 10 in any draft → Free Banana Spin.\n• When the Jackpot is hit, Pick 6 unlocks — Pick 6 and Pick 10 each win a Free Spin until the batch ends.\n• Every Spin wins Free Drafts — up to 20, minimum 1.\n• Paid Drafts Only.',
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
        '• Share your unique referral link with friends.\n• You earn a Free Banana Spin at each milestone as your friend buys draft passes: their 1st pass, 4 total, and 10 total — up to 3 Spins per friend.\n• Your friend must also verify their X account and spin their Free Banana Spin.\n• One account per person — more than one account makes you ineligible to win prizes.\n• Real players only: referrals must actually play fantasy football. Farming free spins with fake invites makes BOTH you and your referral ineligible to win prizes.',
      additionalRules:
        'Referred users must participate in fantasy football to qualify. Banana Fantasy reserves the right to revoke draft passes or drafted teams from users found to be abusing this promotion.',
      inviteCode: 'BANANA-CK99-2026',
      referralLink: 'https://banana-fantasy-sbs.vercel.app?ref=BANANA-CK99-2026',
      referralRewards: [
        { milestone: 'Friend buys their 1st draft pass', reward: '1 Free Banana Spin' },
        { milestone: 'Friend reaches 4 passes total', reward: '1 Free Banana Spin' },
        { milestone: 'Friend reaches 10 passes total', reward: '1 Free Banana Spin' },
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
        '• Engage with the SBS launch tweet (like, repost, or meaningful reply) to earn a Free Banana Spin.\n• Claims are one-time per campaign and reviewed for abuse prevention.',
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
    // NEW ribbon (Boris 2026-07-12). Display-only; promoFilter force-sets it
    // for 'new-user' so already-seeded accounts get the ribbon too.
    isNew: true,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'New User → FREE SPIN',
      explanation:
        '• Verify your account by connecting your X to claim your Free Banana Spin.\n• Then spin the Banana Wheel for a chance to win 20, 10, 5, or 1 Free Drafts — or a Jackpot/HOF draft.\n• One account per person — more than one account makes you ineligible to win prizes.\n• You must actually play fantasy football — accounts made just to farm free spins are not eligible to win prizes.',
      additionalRules: '',
      twitterConnected: false,
    },
  },
  {
    id: '11',
    type: 'first-purchase',
    title: 'First Purchase → WIN UP TO 40 FREE DRAFTS',
    description: 'Buy 1 Pass → 2 Free Spins: 2 Free Drafts GTD · win up to 40 Free Drafts ($1,000 in Drafts)',
    ctaText: 'Buy Drafts',
    ctaLink: '/buy-drafts',
    backgroundColor: '#2a2a35',
    // NEW ribbon since 2026-07-06. This seed carries the NEW-PLAYER variant
    // (2026-07-10: every pass = 2 spins, $1K framing); RETURNING players get
    // the classic copy + classic rate overlaid server-side in getPromos /
    // _incrementMintPromosInTx. isNew is display-only (self-ping removed).
    // promoFilter also force-sets isNew for 'first-purchase'.
    isNew: true,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: 'Buy 1 Pass → 2 Free Spins → up to 40 Free Drafts ($1,000 in Drafts)',
      explanation:
        '• Buy 1 Draft Pass → get 2 Free Spins: 2 Free Drafts guaranteed — win up to 40 Free Drafts ($1,000 in Drafts).\n• Buy 2 → 4 Free Spins: 4 Free Drafts guaranteed — up to 80 Free Drafts ($2,000 in Drafts).\n• Buy 4 → 8 Free Spins: 8 Free Drafts guaranteed — up to 160 Free Drafts ($4,000 in Drafts).\n• No cap — every pass = 2 more Spins.\n• One-time offer: your first purchase only.\n• Your Spins land right here after you buy — claim and spin to collect your Drafts.',
    },
  },
  {
    id: '1',
    type: 'daily-drafts',
    title: '4 Drafts in 24 Hours → FREE SPIN',
    description: 'Complete 4 paid drafts in 24 hours for a Free Spin',
    ctaText: 'Start Drafting',
    ctaLink: '/drafting',
    backgroundColor: '#2a2a35',
    progressCurrent: 0,
    progressMax: 4,
    claimable: false,
    claimCount: 0,
    modalContent: {
      title: '4 Drafts in 24 Hours → FREE SPIN',
      explanation:
        '• Get into 4 paid drafts within 24 hours to earn a Free Banana Spin.\n• A draft counts as soon as it fills — not when it finishes.\n• Your 24-hour clock starts the moment your first paid draft fills.\n• Hit 4 in time and the clock resets instantly for a fresh run — no limit, every 4 paid drafts earns another Spin.\n• If 24 hours pass before you reach 4, your progress toward the spin resets to 0 and the clock restarts when your next paid draft fills.\n• Paid drafts only.',
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
    title: 'Buy 2 → FREE SPIN',
    description: 'July 4th Weekend only!',
    ctaText: 'Buy Now',
    ctaLink: '/buy-drafts',
    backgroundColor: '#2a2a35',
    // Visual NEW ribbon (big featured treatment while FEATURED_PROMO_TYPE =
    // 'buy-bonus'). SAFE again as of 2026-07-03: the isNew client self-ping
    // was deleted (double-bell fix) — the flag is display-only now; the launch
    // announcement stays broadcast-only.
    isNew: true,
    claimable: false,
    claimCount: 0,
    progressCurrent: 0,
    progressMax: 2,
    modalContent: {
      title: '🇺🇸 July 4th: Buy 2 → FREE SPIN',
      explanation:
        '• July 4th Weekend special: every 2 draft passes purchased earns a free Banana Wheel spin!\n• Every spin wins up to 20 Free Drafts — at least 1 guaranteed.\n• No limit — buy 4 passes, earn 2 spins.\n• This weekend only!',
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
        '• Share your Jackpot, HOF, or 5+ draft wins on X.\n• Every 3 verified shares earns you a Free Banana Spin.\n• Small wins can still be shared for bragging rights but don\'t count toward the Spin.\n• Link your X account in your profile first — verification can take up to a minute after tweeting.',
      additionalRules: '',
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
        '• 1 Jackpot draft in every 100 drafts\n• Jackpot hit within first 25 drafts → 1 of the 10 drafters in the Jackpot draft wins 10 Free Banana Spins — up to 200 Free Drafts\n• Jackpot hit within first 50 drafts → 1 of the 10 drafters in the Jackpot draft wins 5 Free Banana Spins — up to 100 Free Drafts\n• Cycle resets after every 100 drafts\n• Winner drawn from VRF randomness sealed on-chain before the draft exists — every draw posts an instant on-chain receipt\n• Jackpot League Perk: Win your Jackpot league and go straight to the finals, skipping the first two rounds of playoffs!\n• Paid Drafts Only.',
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
        '• Founder Draft happens every week at the same time\n• When the clock hits 0:00:00, click "Join Draft" the second it strikes\n• Multiple drafts fill in the rush — the one the founder lands in is the Founder Draft\n• Every drafter in the Founder Draft earns 1 Free Banana Spin to claim\n• Founder League Perk: Score more points than the founder in your Founder league → you\'re entered into a draw with everyone else who beat the founder across all Founder leagues. One person is randomly picked to skip straight to the finals!',
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
