// User types
export interface User {
  id: string;
  username: string;
  walletAddress: string;
  loginMethod?: 'wallet' | 'social';
  profilePicture?: string;
  nflTeam?: string;
  xHandle?: string;
  draftPasses: number;
  usdcBalance: number; // USDC balance on Base (human-readable, e.g. 25.00)
  freeDrafts: number;
  wheelSpins: number;
  jackpotEntries: number;
  hofEntries: number;
  cardPurchaseCount: number;
  // First-purchase bonus (every 4 passes on the first PAID purchase = 1 spin).
  // `firstPurchaseBonusGranted` is the durable "has made a first paid purchase"
  // flag — set once and never reset (cardPurchaseCount resets after 6, so it
  // can't be used for this). `pendingWheelWinnings` counts welcome-wheel free
  // drafts won but not yet completed; when it hits 0 the new-user popup unlocks
  // via `firstPurchasePromoUnlocked`. See lib/promoMath.ts.
  firstPurchaseBonusGranted?: boolean;
  pendingWheelWinnings?: number;
  firstPurchasePromoUnlocked?: boolean;
  // True once the user has spun the Banana Wheel at least once. Drives the
  // first-time "what's a spin?" explainer on promo cards — shown until their
  // first spin, then hidden everywhere.
  hasSpunWheel?: boolean;
  isVerified: boolean;
  referredBy?: string;
  createdAt: string;
  // The single badge ID the user has equipped to display next to their
  // avatar across the app. Null/undefined = no badge shown. The user
  // doesn't have to display one — they can clear this anytime.
  equippedBadge?: string | null;
  // Permanent, server-assigned unique number for the default "Banana12345"
  // handle (shown only to users who never set a username). Assigned once
  // from the `counters/banana_user_number` counter and never changes, so
  // no two users ever share a banana handle. See getOrAssignBananaNumbers.
  bananaNumber?: number;
}

// Badges
export type BadgeCategory = 'drafts' | 'league' | 'finals' | 'wheel' | 'founder' | 'legacy' | 'team';

export interface Badge {
  id: string;
  label: string;
  description: string;
  /** One-line text shown in the catalog when locked, e.g. "Complete 20 drafts". */
  criteria: string;
  category: BadgeCategory;
  /** Tailwind-friendly hex used for the badge ring + glow. */
  color: string;
  /** Single-character / emoji glyph used inside the small circle when no
   *  custom image asset is shipped. */
  glyph: string;
  /** Optional asset path. If unset, BadgeIcon renders the glyph instead. */
  iconUrl?: string;
  /** Secondary color — used for gradients and dual-tone treatments. */
  accentColor?: string;
  /** When true, the background fill blends color → accentColor. */
  gradient?: boolean;
  /** Ring style. 'solid' (default) is a single border. 'double' adds an
   *  inner ring for high-tier badges. 'rainbow' uses an animated rainbow
   *  ring for the rarest. */
  ringStyle?: 'solid' | 'double' | 'rainbow';
  /** Override ring color independently from fill. Useful for HOF-tier
   *  variants of base medals. */
  ringColor?: string;
  /** Visual flair. 'soft' = static drop-shadow. 'pulse' = animated. */
  glow?: 'none' | 'soft' | 'pulse';
  /** Hidden badges (past-season champions, secret unlocks) don't render
   *  in the catalog when locked — they only appear once unlocked. */
  hidden?: boolean;
  /** Cosmetic badges (e.g. NFL team flair) anyone can equip without
   *  earning. Bypasses the unlock check on equip. */
  alwaysUnlocked?: boolean;
}

/** Per-user badge unlock state. Stored at users/{userId}/badges/{badgeId}. */
export interface UserBadge {
  id: string;
  unlocked: boolean;
  unlockedAt?: string;
  /** Free-form metadata about how it was awarded (draftId, leagueId,
   *  reason if admin-granted, etc.). */
  source?: Record<string, unknown>;
}

// Contest types
export type ContestType = 'regular' | 'pro' | 'jackpot' | 'hof';

export interface Contest {
  id: string;
  name: string;
  type: ContestType;
  prizePool: number;
  topPrize: number;
  entryFee: number;
  jpPercent: number;
  hofPercent: number;
  jpHits: number;
  hofHits: number;
  maxEntries: number;
  currentEntries: number;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'active' | 'completed';
  rosterFormat: RosterSlot[];
  scoringRules: ScoringRule[];
  prizeBreakdown: PrizeBreakdown[];
}

export interface RosterSlot {
  position: string;
  count: number;
}

export interface ScoringRule {
  category: string;
  action: string;
  points: number;
}

export interface PrizeBreakdown {
  place: string;
  amount: number;
  percentage?: number;
}

// Draft room types
export interface DraftRoom {
  id: string;
  contestId: string;
  contestName: string;
  players: number;
  maxPlayers: number;
  status: 'filling' | 'ready' | 'drafting' | 'completed';
  type: ContestType;
  entryFee: number;
  draftSpeed: 'fast' | 'slow';
  cardId?: string;
  // Draft turn info (only relevant when status is 'drafting')
  isOnClock?: boolean;
  picksAway?: number;
  timeRemaining?: number; // seconds
}

// Completed draft types (for standings)
export interface CompletedDraft {
  id: string;
  contestName: string;
  type: ContestType;
  finalPlace: number;
  totalPlayers: number;
  score: number;
  prizeWon: number;
  completedDate: string;
  draftSpeed: 'fast' | 'slow';
  topPlayers: { position: string; team: string; points: number }[];
}

// League/Team types
export interface League {
  id: string;
  name: string;
  contestId: string;
  type: ContestType;
  leagueRank: number;
  weeklyRank: number;
  weeklyScore: number;
  seasonScore: number;
  prizeIndicator?: number;
  status: 'active' | 'playoffs' | 'eliminated' | 'completed';
  roster: RosterPlayer[];
  draftDate: string;
}

export interface RosterPlayer {
  slot: string;
  teamPosition: string;
  weeklyPoints: number;
  seasonPoints: number;
  projection?: number;
  isInLineup?: boolean;
  playerName?: string;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  teamName: string;
  seasonScore: number;
  weeklyScore: number;
  isCurrentUser?: boolean;
}

// Player/Rankings types
export interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  seasonPoints: number;
  weeklyPoints: number;
  projectedPoints: number;
  byeWeek: number;
}

export interface TeamPosition {
  id: string;
  team: string;
  position: string;
  currentPlayer: string;
  seasonPoints: number;
  weeklyPoints: number;
  projectedPoints: number;
  byeWeek: number;
  adp: number;
  adpChange: number; // positive = moved up, negative = moved down
  depthChart: DepthChartPlayer[];
}

export interface DepthChartPlayer {
  name: string;
  status: 'starter' | 'backup' | 'injured';
  projectedPoints: number;
}

// Wheel types
export type WheelPrize =
  | { type: 'drafts'; amount: 1 | 5 | 10 | 20 }
  | { type: 'jackpot' }
  | { type: 'hof' };

export interface WheelSpin {
  id: string;
  date: string;
  prize: WheelPrize;
  claimed: boolean;
}

// Prize types
export type PrizeStatus = 'paid' | 'processing' | 'forfeited' | 'pending';

export interface Prize {
  id: string;
  contestName: string;
  amount: number;
  status: PrizeStatus;
  paidDate?: string;
  forfeitReason?: string;
}

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface PrizeWin extends Prize {
  type: 'win';
  draftId?: string;
  createdAt?: string;
}

export interface PrizeWithdrawal {
  id: string;
  type: 'withdrawal';
  userId: string;
  draftId?: string;
  amount: number;
  method: 'usdc' | 'bank';
  status: WithdrawalStatus;
  createdAt: string;
  updatedAt?: string;
}

export type PrizeHistoryItem = PrizeWin | PrizeWithdrawal;

export type EligibilityCheckStatus = 'verified' | 'pending' | 'unverified';

export interface EligibilityStatus {
  isVerified: boolean;
  season: number;
  w9Completed: boolean;
  lastVerifiedDate?: string;
  // Persona verification tiers
  tier1Verified: boolean; // age + geo (first withdrawal)
  tier2Verified: boolean; // full KYC (cumulative $2k+)
  cumulativeWithdrawals: number;
  geoState?: string;
  personaInquiryId?: string;
}

// Promo types
export type PromoType = 'daily-drafts' | 'pick-10' | 'referral' | 'jackpot' | 'hof' | 'mint' | 'new-user' | 'buy-bonus' | 'tweet-engagement' | 'add-to-home-screen' | 'spin-share' | 'founder-draft' | 'first-purchase';

// Spin share (X share credit) types — currently wheel-only
export type SpinShareType = 'wheel';

export interface SpinShareRecord {
  userId: string;
  shareType: SpinShareType;
  sourceId: string; // spinId
  prize: string; // e.g. "jackpot", "hof", "draft-5"
  tweetId: string;
  tweetUrl: string;
  earnsCredit: boolean;
  verifiedAt: string;
}

export interface ReferralReward {
  milestone: string;
  reward: string;
}

export interface ReferralEntryRewards {
  verified: 'pending' | 'claim' | 'claimed';
  bought1: 'pending' | 'claim' | 'claimed';
  bought10: 'pending' | 'claim' | 'claimed';
}

export interface ReferralEntry {
  username: string;
  referredUserId?: string;
  dateJoined: string;
  status: 'pending' | 'claim' | 'claimed';
  pendingReason?: string;
  draftsPurchased?: number;
  rewards?: ReferralEntryRewards;
}

export interface Promo {
  id: string;
  type: PromoType;
  title: string;
  description: string;
  imageUrl?: string;
  ctaText: string;
  ctaLink: string;
  backgroundColor?: string;
  progressCurrent?: number;
  progressMax?: number;
  timerEndTime?: string;
  claimable?: boolean;
  claimCount?: number;
  completedDraftIds?: string[];
  isNew?: boolean;
  modalContent: {
    title: string;
    explanation: string;
    additionalRules?: string;
    inviteCode?: string;
    referralLink?: string;
    referralRewards?: ReferralReward[];
    referralHistory?: ReferralEntry[];
    twitterConnected?: boolean;
    pick10History?: { date: string; draftName: string; status: 'pending' | 'claim' | 'claimed' }[];
    totalPick10s?: number;
    jackpotHistory?: { date: string; draftName: string; amount: number }[];
    founderHistory?: { date: string; draftName: string; amount: number }[];
    mintHistory?: { date: string; quantity: number; status: 'pending' | 'claim' | 'claimed' }[];
    totalMinted?: number;
  };
}

// Special draft queue types
export type QueueType = 'jackpot' | 'hof';
export type RoundStatus = 'filling' | 'ready' | 'drafting' | 'completed';

export interface QueueMember {
  wallet: string;
  joinedAt: number;
}

export interface QueueRound {
  roundId: number;
  members: QueueMember[];
  status: RoundStatus;
  draftId: string | null;
}

export interface DraftQueue {
  type: QueueType;
  rounds: QueueRound[];
  nextRoundId: number;
}

// Transaction types
export interface DraftPassPurchase {
  quantity: number;
  pricePerPass: number;
  totalPrice: number;
  currency: 'USDC' | 'USD';
}

// FAQ types
export interface FAQSection {
  id: string;
  title: string;
  items: FAQItem[];
}

export interface FAQItem {
  question: string;
  answer: string;
  link?: {
    label: string;
    href: string;
  };
}

// Standings types (real API)
export interface StandingsTeam {
  cardId: string;
  leagueId: string;
  leagueName: string;
  level: 'Pro' | 'HOF' | 'Jackpot';
  leagueRank: number;
  weeklyRank: number;
  weeklyScore: number;
  seasonScore: number;
  status: 'active' | 'playoffs' | 'eliminated' | 'completed';
  roster: StandingsRosterPlayer[];
}

export interface StandingsRosterPlayer {
  position: string;
  teamPosition: string;
  weeklyPoints: number;
  seasonPoints: number;
  isActiveForWeek: boolean;
}

export interface LeagueStanding {
  rank: number;
  cardId: string;
  ownerWallet: string;
  displayName: string;
  weeklyScore: number;
  seasonScore: number;
  isCurrentUser: boolean;
}

// --- New API types (temporary Next.js backend) ---

// Purchases / Payments
export type PurchaseStatus = 'pending' | 'completed' | 'failed' | 'expired';
export type PurchasePaymentMethod = 'usdc' | 'card';

export interface Purchase {
  id: string;
  userId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: 'USDC' | 'USD';
  paymentMethod: PurchasePaymentMethod;
  chain?: 'base';
  status: PurchaseStatus;
  createdAt: string;
  verifiedAt?: string;
  txHash?: string;
}

export interface PurchasePaymentInstructions {
  toAddress: string;
  chainId: number;
  tokenAddress: string;
  amount: string;
  decimals: number;
}

export interface PurchaseCreateResponse {
  purchase: Purchase;
  payment: PurchasePaymentInstructions;
}

// Referral / Promos
export interface ReferralStats {
  userId: string;
  code: string;
  link: string;
  totalReferrals: number;
  claimableRewards: number;
  referralRewards: ReferralReward[];
  referralHistory: ReferralEntry[];
}

// Exposure
export interface ExposureEntry {
  team: string;
  position: string;
  teamPosition: string;
  drafts: number;
  totalDrafts: number;
  exposure: number; // percentage
  /** Optional display fields preserved across recomputes. */
  displayName?: string;
  bye?: number;
  adp?: number;
  projectedPoints?: number;
  /** Avg overall pick number we actually drafted this team-position at,
   *  averaged across all our drafts (from each draft's playerState pickNum).
   *  Undefined when pick data wasn't available. Pairs with `adp`. */
  avgPick?: number;
}

export interface UserExposure {
  username: string;
  totalDrafts: number;
  exposures: ExposureEntry[];
}
