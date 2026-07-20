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
  /**
   * @deprecated Superseded by `cardFeeCreditCents`. The old "every 6 card
   * purchases = 1 free draft" counter; no longer incremented or read.
   */
  cardPurchaseCount: number;
  /**
   * Running card-fee credit toward the next free draft, in integer cents.
   * Each card purchase adds the MoonPay fee for that quantity (see
   * `feeForQty` in lib/pricing.ts); at `FREE_DRAFT_CREDIT_CENTS` ($25) the
   * user earns 1 paid-type draft and the remainder rolls over.
   */
  cardFeeCreditCents: number;
  /**
   * True once the user has received their FRONTED card-fee draft — the free
   * pass granted on their first-ever card purchase (or via the 2026-07-19
   * backfill for users who had already paid card fees). While false, the buy
   * flow shows the one-time "we cover your card fees" explainer and the next
   * card purchase grants the fronted pass. Set once, never reset.
   */
  cardFeeFrontGranted?: boolean;
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
  // Current "ripeness" — the dynamic banana badge everyone has, computed
  // server-side from how many paid BBB4 passes they've bought. Surfaced so
  // every render site can color the default banana per user. See
  // lib/badges/ripeness.ts. Not stored — recomputed on read.
  ripeness?: Ripeness;
}

/**
 * The dynamic "ripeness" of a user's banana — the default badge everyone
 * carries when they haven't equipped an earned one. Computed from the count
 * of paid passes they've bought in BBB4 (see lib/badges/ripeness.ts).
 */
export interface Ripeness {
  /** 0–5, lowest (Unripe) to highest (Spoiled). */
  tier: number;
  /** Human label, e.g. "Ripe". */
  label: string;
  /** Banana fill color for this tier (green → spoiled-brown). */
  color: string;
  /** Display range, e.g. "20–40". */
  range: string;
  /** Paid BBB4 passes bought (the value the tier was derived from). */
  count: number;
}

// Badges
//
// The badge system is the "obsidian disc": a dark-glass center with a solid
// colored rim and a flat icon (no glow). Each badge declares HOW its center
// content renders via `contentKind`, plus the rim/content colors. See
// components/badges/BadgeIcon.tsx (renderer) and lib/badges/catalog.ts.
export type BadgeCategory = 'ripeness' | 'championship' | 'club' | 'status' | 'team';

/** How the obsidian disc's center content is drawn. */
export type BadgeContentKind =
  | 'banana'        // vectorized SBS banana, filled with the ripeness tier color
  | 'text'          // short letters (JP / HOF / OG)
  | 'numeral-crown' // small filled crown above a roman numeral (BBB champion)
  | 'hof-champ'     // small crown above "HOF" + season numeral (HOF champion)
  | 'icon'          // a flat line icon (King crown outline / Founders key)
  | 'logo';         // a full-color image (NFL team logo via iconUrl)

export interface Badge {
  id: string;
  label: string;
  description: string;
  /** One-line text shown in the catalog when locked, e.g. "Complete 20 drafts". */
  criteria: string;
  category: BadgeCategory;
  // ── Obsidian-disc render fields ──────────────────────────────────────
  /** How the center content renders. Drives BadgeIcon. */
  contentKind: BadgeContentKind;
  /** Solid rim color around the disc. Grey (#48484f) by default; prestige
   *  badges get a colored rim (blue/gold/red/purple). */
  rimColor: string;
  /** Color of the center content (text / icon stroke / crown fill). Unused
   *  by `banana` (tier color) and `logo` (full-color image). */
  contentColor?: string;
  /** Which flat line icon to draw for `contentKind: 'icon'`. */
  iconName?: 'crown' | 'key';
  /** Short text drawn for `contentKind: 'text'` (e.g. "JP", "HOF", "OG"). */
  text?: string;
  /** Roman-numeral season for champion badges (e.g. "I", "IV"). */
  numeral?: string;
  /** Marks a computed badge whose appearance is derived at render time
   *  rather than from a fixed unlock. 'ripeness' = the dynamic banana whose
   *  fill color comes from the user's purchase tier. */
  dynamic?: 'ripeness';
  // ── Shared / back-compat ─────────────────────────────────────────────
  /** Representative hex (mirrors rimColor) kept for back-compat with code
   *  that still reads `badge.color`. */
  color: string;
  /** Emoji used in unlock toasts + bell notifications (NOT the disc render). */
  glyph: string;
  /** Image asset for `contentKind: 'logo'` (NFL team logo). */
  iconUrl?: string;
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
  /** Number of paid drafts the example prize breakdown is modeled on (e.g. 5000). The real pool grows with entries. */
  examplePaidDrafts?: number;
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
  /** Small qualifier shown next to the amount, e.g. "each" or "each · 200 leagues" */
  note?: string;
  /** Optional grouping header, e.g. "Finals", "League Prizes", "Hall of Fame" */
  section?: string;
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
export type PromoType = 'daily-drafts' | 'pick-10' | 'referral' | 'jackpot' | 'hof' | 'mint' | 'new-user' | 'buy-bonus' | 'tweet-engagement' | 'spin-share' | 'founder-draft' | 'first-purchase';

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
  /** Friend verified X + used their spin — informational only since
   *  2026-06-10 (no referrer payout; payouts start at bought1). */
  verified: 'pending' | 'claim' | 'claimed';
  bought1: 'pending' | 'claim' | 'claimed';
  /** Friend's LIFETIME passes reached 4 (added 2026-06-10). */
  bought4?: 'pending' | 'claim' | 'claimed';
  bought10: 'pending' | 'claim' | 'claimed';
}

export interface ReferralEntry {
  /** ISO timestamps for when each bought milestone was hit (real history). */
  milestoneDates?: { bought1?: string; bought4?: string; bought10?: string };
  /** When the friend verified X + claimed their spin (unlocks the ladder). */
  verifiedAt?: string;
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
  /** Limited-time featured promo (FEATURED_PROMO_TYPE in promoFilter):
   *  pinned to position 1 on every surface + big NEW badge treatment. */
  featured?: boolean;
  /** New-user promo only: admin force-granted to a returning player. Lets the
   *  client filter show it despite isBB3Holder (returning) hiding it normally.
   *  Set server-side in getPromos; claimed/spun still hide it. */
  forced?: boolean;
  modalContent: {
    title: string;
    explanation: string;
    additionalRules?: string;
    inviteCode?: string;
    referralLink?: string;
    referralRewards?: ReferralReward[];
    referralHistory?: ReferralEntry[];
    twitterConnected?: boolean;
    pick10History?: { date: string; draftName: string; status: 'pending' | 'claim' | 'claimed'; slot?: number }[];
    totalPick10s?: number;
    jackpotHistory?: { date: string; draftName: string; amount: number }[];
    founderHistory?: { date: string; draftName: string; amount: number }[];
    mintHistory?: { date: string; quantity: number; status: 'pending' | 'claim' | 'claimed' }[];
    totalMinted?: number;
    /** All-time 4-draft completions (daily-drafts promo) — never decrements. */
    totalDailyClaims?: number;
    /** One entry per completed 4-set (daily-drafts promo), newest first. */
    dailyHistory?: { date: string; count: number }[];
    /** Authoritative Go count of paid FILLED drafts — stamped at read time. */
    lifetimePaidDrafts?: number;
    /** Jackpot promo: live cycle data stamped at read time. */
    cycle?: { filledCount: number; position: number; tenLeft: number; fiveLeft: number };
    /** Jackpot promo: most recent draw (social proof in the modal). */
    latestDraw?: { draftName: string; winnerName: string; reward: number; atIso: string };
  };
}

// Special draft queue types
export type QueueType = 'jackpot' | 'hof';
export type RoundStatus = 'filling' | 'ready' | 'drafting' | 'completed';

export interface QueueMember {
  wallet: string;
  joinedAt: number;
  // Set for wheel-won JP/HOF passes minted as a real NFT: the queue slot is tied
  // to this token, and the draft is created for whoever owns it at fill time (so
  // a sale-while-filling hands the slot to the buyer).
  tokenId?: string;
}

export interface QueueRound {
  roundId: number;
  members: QueueMember[];
  status: RoundStatus;
  draftId: string | null;
  /** Set (epoch ms) while one server request holds the right to create the Go
   *  league for this round — prevents two simultaneous wheel winners creating
   *  two leagues. Stale claims (>60s, create crashed) are taken over. */
  creatingAt?: number | null;
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
// Audience targeting for FAQ content. Omitted = 'all' (everyone sees it).
// 'web3' = crypto-only (hidden from confirmed web2 / embedded-wallet users).
// 'web2' = plain-language version shown ONLY to web2 users.
export type FAQAudience = 'all' | 'web3' | 'web2';

export interface FAQSection {
  id: string;
  title: string;
  items: FAQItem[];
  audience?: FAQAudience;
}

export interface FAQItem {
  question: string;
  answer: string;
  audience?: FAQAudience;
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
