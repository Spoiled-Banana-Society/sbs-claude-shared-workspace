import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import type {
  CompletedDraft,
  Contest,
  LeaderboardEntry,
  Promo,
  PrizeWithdrawal,
  Purchase,
  PurchaseCreateResponse,
  PurchasePaymentInstructions,
  ReferralEntry,
  ReferralEntryRewards,
  ReferralStats,
  User,
  UserExposure,
  WheelPrize,
  WheelSpin,
} from '@/types';
import { API_CONFIG } from '@/lib/api/config';
import { ApiError } from '@/lib/api/errors';
import type { DbSchema } from '@/lib/api/dbTypes';
import { seedDb } from '@/lib/api/seed';

// On Vercel, process.cwd() is read-only — use /tmp for writable storage.
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let dbCache: DbSchema | null = null;

function deepClone<T>(value: T): T {
  // structuredClone is available in Node 17+.
  // Fallback: JSON clone for our simple data shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any).structuredClone as undefined | ((v: any) => any);
  if (sc) return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(seedDb, null, 2), 'utf8');
  }
}

async function loadDb(): Promise<DbSchema> {
  if (dbCache) return dbCache;
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, 'utf8');
  dbCache = JSON.parse(raw) as DbSchema;
  return dbCache;
}

async function saveDb(db: DbSchema) {
  await ensureDbFile();
  const tmpPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmpPath, DB_PATH);
  dbCache = db;
}

async function updateDb<T>(mutator: (db: DbSchema) => T | Promise<T>): Promise<T> {
  const db = deepClone(await loadDb());
  const result = await mutator(db);
  await saveDb(db);
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function getOrCreateUser(db: DbSchema, userId: string): User {
  const existing = db.users[userId];
  if (existing) return existing;

  // Minimal default user (dev convenience)
  const user: User = {
    id: userId,
    username: `User${userId}`,
    walletAddress: '0x0',
    draftPasses: 0,
    freeDrafts: 0,
    wheelSpins: 0,
    jackpotEntries: 0,
    hofEntries: 0,
    isVerified: false,
    createdAt: todayDate(),
  };
  db.users[userId] = user;
  db.promosByUser[userId] = deepClone(seedDb.promosByUser['1'] ?? []);
  db.wheelSpinsByUser[userId] = [];
  db.exposureByUser[userId] = {
    username: user.username,
    totalDrafts: 0,
    exposures: [],
  };
  db.draftHistoryByUser[userId] = [];
  db.referralsByUser[userId] = { code: '', createdAt: todayDate() };
  return user;
}

function selectWeightedPrize(): WheelPrize {
  const odds = API_CONFIG.wheel.odds;
  const total = odds.reduce((sum, o) => sum + o.weight, 0);
  if (total <= 0) throw new ApiError(500, 'Wheel odds misconfigured');

  const r = Math.random() * total;
  let cumulative = 0;
  for (const o of odds) {
    cumulative += o.weight;
    if (r <= cumulative) return o.prize;
  }
  return odds[odds.length - 1].prize;
}

function applyWheelPrize(user: User, prize: WheelPrize) {
  if (prize.type === 'drafts') {
    user.freeDrafts = (user.freeDrafts || 0) + prize.amount;
    return;
  }
  if (prize.type === 'jackpot') {
    user.jackpotEntries = (user.jackpotEntries || 0) + 1;
    return;
  }
  if (prize.type === 'hof') {
    user.hofEntries = (user.hofEntries || 0) + 1;
  }
}

function recalcPromoClaimable(promo: Promo) {
  // Basic default: if claimCount > 0, claimable.
  if (typeof promo.claimCount === 'number') {
    promo.claimable = promo.claimCount > 0;
  }
}

export async function getPromos(userId: string): Promise<Promo[]> {
  const db = await loadDb();
  if (!db.users[userId]) {
    // Non-mutating call: still allow returning seed promos.
    return deepClone(seedDb.promosByUser['1'] ?? []);
  }
  return deepClone(db.promosByUser[userId] ?? []);
}

export async function claimPromo(userId: string, promoId: string) {
  return updateDb((db) => {
    const user = getOrCreateUser(db, userId);
    const promos = db.promosByUser[userId] ?? [];
    const promo = promos.find((p) => p.id === promoId);
    if (!promo) throw new ApiError(404, 'Promo not found');

    // Determine number of spins to add by claiming.
    // For some promos we claim all claimable history items.
    let spinsAdded = 0;

    if (promo.type === 'pick-10' && promo.modalContent.pick10History) {
      const claimables = promo.modalContent.pick10History.filter((h) => h.status === 'claim');
      spinsAdded = claimables.length;
      promo.modalContent.pick10History = promo.modalContent.pick10History.map((h) =>
        h.status === 'claim' ? { ...h, status: 'claimed' } : h
      );
    } else if (promo.type === 'referral' && promo.modalContent.referralHistory) {
      // Count claimable rewards across referral entries.
      for (const entry of promo.modalContent.referralHistory) {
        if (!entry.rewards) continue;
        const keys: Array<keyof NonNullable<typeof entry.rewards>> = ['verified', 'bought1', 'bought10'];
        for (const k of keys) {
          if (entry.rewards[k] === 'claim') {
            entry.rewards[k] = 'claimed';
            spinsAdded += 1;
          }
        }
        const allClaimed = keys.every((k) => entry.rewards && entry.rewards[k] === 'claimed');
        if (allClaimed) entry.status = 'claimed';
        else if (spinsAdded > 0) entry.status = 'pending';
      }
    } else {
      if (!promo.claimable) throw new ApiError(400, 'Promo is not currently claimable');
      const count = promo.claimCount ?? 1;
      if (count <= 0) throw new ApiError(400, 'No claims available');
      spinsAdded = count;
      promo.claimCount = 0;
    }

    if (spinsAdded <= 0) throw new ApiError(400, 'Nothing to claim');

    // Buy-bonus gives free draft passes, other promos give wheel spins.
    let freeDraftsAdded = 0;
    if (promo.type === 'buy-bonus') {
      freeDraftsAdded = spinsAdded * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
      user.freeDrafts = (user.freeDrafts || 0) + freeDraftsAdded;
      spinsAdded = 0; // No wheel spins for buy-bonus
    } else {
      user.wheelSpins = (user.wheelSpins || 0) + spinsAdded;
    }
    promo.claimable = false;
    promo.claimCount = 0;

    return { promo: deepClone(promo), spinsAdded, freeDraftsAdded, user: deepClone(user) };
  });
}

export async function updatePromo(userId: string, promoId: string, patch: Partial<Pick<Promo, 'claimable' | 'claimCount'>>) {
  return updateDb((db) => {
    getOrCreateUser(db, userId);
    const promos = db.promosByUser[userId] ?? [];
    const promo = promos.find((p) => p.id === promoId);
    if (!promo) throw new ApiError(404, 'Promo not found');

    if (patch.claimable !== undefined) promo.claimable = patch.claimable;
    if (patch.claimCount !== undefined) promo.claimCount = patch.claimCount;

    return deepClone(promo);
  });
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = await loadDb();
  const promos = db.promosByUser[userId] ?? seedDb.promosByUser['1'] ?? [];
  const referralPromo = promos.find((p) => p.type === 'referral');
  const code = (db.referralsByUser[userId]?.code || referralPromo?.modalContent.inviteCode || '').trim();
  const link = referralPromo?.modalContent.referralLink || (code ? `https://banana-fantasy-sbs.vercel.app?ref=${code}` : '');
  const history = referralPromo?.modalContent.referralHistory ?? [];

  let claimableRewards = 0;
  for (const entry of history) {
    if (!entry.rewards) continue;
    if (entry.rewards.verified === 'claim') claimableRewards++;
    if (entry.rewards.bought1 === 'claim') claimableRewards++;
    if (entry.rewards.bought10 === 'claim') claimableRewards++;
  }

  return {
    userId,
    code,
    link,
    totalReferrals: history.length,
    claimableRewards,
    referralRewards: referralPromo?.modalContent.referralRewards ?? [],
    referralHistory: history,
  };
}

export async function generateReferralCode(userId: string, username?: string) {
  return updateDb((db) => {
    getOrCreateUser(db, userId);

    const base = (username || db.users[userId]?.username || `USER-${userId}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `BANANA-${base}-${suffix}`;

    db.referralsByUser[userId] = { code, createdAt: todayDate() };

    // Also update promo modal content for convenience.
    const promos = db.promosByUser[userId] ?? [];
    const referralPromo = promos.find((p) => p.type === 'referral');
    if (referralPromo) {
      referralPromo.modalContent.inviteCode = code;
      referralPromo.modalContent.referralLink = `https://banana-fantasy-sbs.vercel.app?ref=${code}`;
    }

    return { code, link: `https://banana-fantasy-sbs.vercel.app?ref=${code}` };
  });
}

export async function trackReferral(referrerUserId: string, referredUserId: string, referredUsername: string) {
  return updateDb((db) => {
    getOrCreateUser(db, referrerUserId);
    const referredUser = getOrCreateUser(db, referredUserId);

    // Mark referred user
    referredUser.referredBy = referrerUserId;

    // Add entry to referrer's referral promo history
    const promos = db.promosByUser[referrerUserId] ?? [];
    const referralPromo = promos.find((p) => p.type === 'referral');
    if (!referralPromo) return { success: false };

    if (!referralPromo.modalContent.referralHistory) {
      referralPromo.modalContent.referralHistory = [];
    }

    // Don't add duplicate entries
    const exists = referralPromo.modalContent.referralHistory.some(
      (e) => e.referredUserId === referredUserId
    );
    if (exists) return { success: true, duplicate: true };

    const entry: ReferralEntry = {
      username: referredUsername,
      referredUserId,
      dateJoined: todayDate(),
      status: 'pending',
      draftsPurchased: 0,
      rewards: { verified: 'pending', bought1: 'pending', bought10: 'pending' },
    };
    referralPromo.modalContent.referralHistory.push(entry);

    return { success: true };
  });
}

export async function updateReferralRewards(referredUserId: string, milestone: keyof ReferralEntryRewards) {
  return updateDb((db) => {
    const referredUser = db.users[referredUserId];
    if (!referredUser?.referredBy) return { updated: false };

    const referrerUserId = referredUser.referredBy;
    const promos = db.promosByUser[referrerUserId] ?? [];
    const referralPromo = promos.find((p) => p.type === 'referral');
    if (!referralPromo?.modalContent.referralHistory) return { updated: false };

    const entry = referralPromo.modalContent.referralHistory.find(
      (e) => e.referredUserId === referredUserId
    );
    if (!entry?.rewards) return { updated: false };

    // Only upgrade from 'pending' to 'claim'
    if (entry.rewards[milestone] !== 'pending') return { updated: false };

    entry.rewards[milestone] = 'claim';
    entry.status = 'claim';
    referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
    referralPromo.claimable = true;

    return { updated: true, referrerUserId };
  });
}

export async function spinWheel(userId: string): Promise<{ spin: WheelSpin; user: User }> {
  return updateDb((db) => {
    const user = getOrCreateUser(db, userId);
    if ((user.wheelSpins || 0) <= 0) throw new ApiError(400, 'No spins available');

    user.wheelSpins = Math.max(0, (user.wheelSpins || 0) - 1);
    const prize = selectWeightedPrize();
    applyWheelPrize(user, prize);

    const spin: WheelSpin = {
      id: crypto.randomUUID(),
      date: todayDate(),
      prize,
      claimed: true,
    };

    const history = db.wheelSpinsByUser[userId] ?? [];
    history.unshift(spin);
    db.wheelSpinsByUser[userId] = history;

    return { spin: deepClone(spin), user: deepClone(user) };
  });
}

export async function getWheelHistory(userId: string): Promise<WheelSpin[]> {
  const db = await loadDb();
  return deepClone(db.wheelSpinsByUser[userId] ?? []);
}

function calcSpinsForPurchase(quantity: number): number {
  return Math.floor(quantity / API_CONFIG.purchases.spinsPerPasses);
}

function calcBuyBonusFreeDrafts(quantity: number): number {
  if (!API_CONFIG.promos.buyBonus.enabled) return 0;
  return Math.floor(quantity / API_CONFIG.promos.buyBonus.buy) * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
}

export async function createPurchase(userId: string, quantity: number, paymentMethod: Purchase['paymentMethod']): Promise<PurchaseCreateResponse> {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(400, 'quantity must be a positive integer');

  return updateDb((db) => {
    const user = getOrCreateUser(db, userId);
    void user;

    const unitPrice = API_CONFIG.purchases.pricePerPassUsd;
    const totalPrice = unitPrice * quantity;

    const purchase: Purchase = {
      id: crypto.randomUUID(),
      userId,
      quantity,
      unitPrice,
      totalPrice,
      currency: paymentMethod === 'usdc' ? 'USDC' : 'USD',
      paymentMethod,
      chain: paymentMethod === 'usdc' ? 'base' : undefined,
      status: 'pending',
      createdAt: nowIso(),
    };

    db.purchases.push(purchase);

    const payment: PurchasePaymentInstructions = {
      toAddress: API_CONFIG.purchases.usdc.toAddress,
      chainId: API_CONFIG.purchases.usdc.chainId,
      tokenAddress: API_CONFIG.purchases.usdc.tokenAddress,
      amount: String(totalPrice),
      decimals: API_CONFIG.purchases.usdc.decimals,
    };

    return { purchase: deepClone(purchase), payment };
  });
}

export async function verifyPurchase(purchaseId: string, txHash: string) {
  return updateDb((db) => {
    const purchase = db.purchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new ApiError(404, 'Purchase not found');
    if (purchase.status === 'completed') {
      return { purchase: deepClone(purchase), user: deepClone(db.users[purchase.userId]), spinsAdded: 0, draftPassesAdded: 0, freeDraftsAdded: 0 };
    }
    if (purchase.status !== 'pending') throw new ApiError(400, `Purchase cannot be verified from status: ${purchase.status}`);

    const user = getOrCreateUser(db, purchase.userId);

    purchase.status = 'completed';
    purchase.verifiedAt = nowIso();
    purchase.txHash = txHash;

    const draftPassesAdded = purchase.quantity;
    user.draftPasses = (user.draftPasses || 0) + draftPassesAdded;

    const spinsAdded = calcSpinsForPurchase(purchase.quantity);
    user.wheelSpins = (user.wheelSpins || 0) + spinsAdded;

    // Free drafts from buy-bonus are awarded on claim, not auto-awarded.
    let freeDraftsAdded = 0;

    // Update promo progress for mint promo.
    const promos = db.promosByUser[purchase.userId] ?? [];
    const mintPromo = promos.find((p) => p.type === 'mint');
    if (mintPromo) {
      mintPromo.modalContent.totalMinted = (mintPromo.modalContent.totalMinted || 0) + purchase.quantity;
      const max = mintPromo.progressMax || 10;
      const current = mintPromo.progressCurrent || 0;
      const newTotal = current + purchase.quantity;
      mintPromo.progressCurrent = newTotal % max;
      const newlyEarned = Math.floor(newTotal / max);
      if (newlyEarned > 0) {
        mintPromo.claimCount = (mintPromo.claimCount || 0) + newlyEarned;
        recalcPromoClaimable(mintPromo);
      }
    }

    // Update promo progress for buy-bonus promo.
    const buyBonusPromo = promos.find((p) => p.type === 'buy-bonus');
    if (buyBonusPromo) {
      const max = buyBonusPromo.progressMax || 2;
      const current = buyBonusPromo.progressCurrent || 0;
      const newTotal = current + purchase.quantity;
      buyBonusPromo.progressCurrent = newTotal % max;
      const newlyEarned = Math.floor(newTotal / max);
      if (newlyEarned > 0) {
        buyBonusPromo.claimCount = (buyBonusPromo.claimCount || 0) + newlyEarned;
        recalcPromoClaimable(buyBonusPromo);
        freeDraftsAdded = newlyEarned * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
      }
    }

    // Referral purchase milestones
    if (user.referredBy) {
      const totalPurchases = db.purchases.filter(
        (p) => p.userId === purchase.userId && p.status === 'completed'
      ).length;
      const referralPromo = db.promosByUser[user.referredBy]?.find((p) => p.type === 'referral');
      if (referralPromo?.modalContent.referralHistory) {
        const entry = referralPromo.modalContent.referralHistory.find(
          (e) => e.referredUserId === purchase.userId
        );
        if (entry) {
          entry.draftsPurchased = totalPurchases;
        }
      }
      if (totalPurchases >= 1) {
        const entry = referralPromo?.modalContent.referralHistory?.find(
          (e) => e.referredUserId === purchase.userId
        );
        if (entry?.rewards?.bought1 === 'pending') {
          entry.rewards.bought1 = 'claim';
          entry.status = 'claim';
          referralPromo!.claimCount = (referralPromo!.claimCount || 0) + 1;
          referralPromo!.claimable = true;
        }
      }
      if (totalPurchases >= 10) {
        const entry = referralPromo?.modalContent.referralHistory?.find(
          (e) => e.referredUserId === purchase.userId
        );
        if (entry?.rewards?.bought10 === 'pending') {
          entry.rewards.bought10 = 'claim';
          entry.status = 'claim';
          referralPromo!.claimCount = (referralPromo!.claimCount || 0) + 1;
          referralPromo!.claimable = true;
        }
      }
    }

    return {
      purchase: deepClone(purchase),
      user: deepClone(user),
      spinsAdded,
      draftPassesAdded,
      freeDraftsAdded,
    };
  });
}

export async function getPurchaseHistory(userId: string): Promise<Purchase[]> {
  const db = await loadDb();
  return deepClone(db.purchases.filter((p) => p.userId === userId));
}

export async function createWithdrawal(
  userId: string,
  draftId: string,
  amount: number,
  method: PrizeWithdrawal['method'],
  status: PrizeWithdrawal['status'] = 'pending'
): Promise<PrizeWithdrawal> {
  if (!userId) throw new ApiError(400, 'userId is required');
  if (!draftId) throw new ApiError(400, 'draftId is required');
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'amount must be a positive number');

  return updateDb((db) => {
    getOrCreateUser(db, userId);
    if (!db.withdrawals) db.withdrawals = [];

    const withdrawal: PrizeWithdrawal = {
      id: crypto.randomUUID(),
      type: 'withdrawal',
      userId,
      draftId,
      amount,
      method,
      status,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    db.withdrawals.unshift(withdrawal);
    return deepClone(withdrawal);
  });
}

export async function getWithdrawalsByUser(userId: string): Promise<PrizeWithdrawal[]> {
  const db = await loadDb();
  const withdrawals = db.withdrawals ?? [];
  return deepClone(withdrawals.filter((w) => w.userId === userId));
}

export async function getContests(): Promise<Contest[]> {
  const db = await loadDb();
  return deepClone(db.contests);
}

export async function getContest(contestId: string): Promise<Contest | null> {
  const db = await loadDb();
  return deepClone(db.contests.find((c) => c.id === contestId) ?? null);
}

export async function getContestStandings(contestId: string): Promise<LeaderboardEntry[]> {
  const db = await loadDb();
  return deepClone(db.standingsByContestId[contestId] ?? []);
}

export async function getExposure(userId: string): Promise<UserExposure | null> {
  const db = await loadDb();
  return deepClone(db.exposureByUser[userId] ?? null);
}

export async function getDraftHistory(userId: string): Promise<CompletedDraft[]> {
  const db = await loadDb();
  return deepClone(db.draftHistoryByUser[userId] ?? []);
}
