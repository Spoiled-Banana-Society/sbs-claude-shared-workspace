import type {
  CompletedDraft,
  Contest,
  LeaderboardEntry,
  Promo,
  PrizeWithdrawal,
  Purchase,
  User,
  UserBadge,
  UserExposure,
  WheelSpin,
} from '@/types';

export interface DbSchema {
  users: Record<string, User>;
  promosByUser: Record<string, Promo[]>;
  wheelSpinsByUser: Record<string, WheelSpin[]>;
  badgesByUser: Record<string, UserBadge[]>;
  purchases: Purchase[];
  withdrawals: PrizeWithdrawal[];
  contests: Contest[];
  standingsByContestId: Record<string, LeaderboardEntry[]>;
  exposureByUser: Record<string, UserExposure>;
  draftHistoryByUser: Record<string, CompletedDraft[]>;
  referralsByUser: Record<string, { code: string; createdAt: string }>;
}
