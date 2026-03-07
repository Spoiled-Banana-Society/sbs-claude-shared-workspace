import crypto from 'node:crypto';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { API_CONFIG } from '@/lib/api/config';
import { ApiError } from '@/lib/api/errors';
import { seedDb } from '@/lib/api/seed';
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

const USERS_COLLECTION = 'v2_users';
const PURCHASES_COLLECTION = 'v2_purchases';
const WITHDRAWALS_COLLECTION = 'withdrawalRequests';
const CONTESTS_COLLECTION = 'v2_contests';

const REFERRAL_CODES_COLLECTION = 'v2_referral_codes';
const PROMOS_SUBCOLLECTION = 'promos';
const WHEEL_SPINS_SUBCOLLECTION = 'wheelSpins';
const REFERRAL_DOC = 'referral';
const EXPOSURE_DOC = 'exposure';
const DRAFT_HISTORY_SUBCOLLECTION = 'draftHistory';
const STANDINGS_SUBCOLLECTION = 'standings';

function deepClone<T>(value: T): T {
  // structuredClone is available in Node 17+.
  // Fallback: JSON clone for our simple data shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any).structuredClone as undefined | ((v: any) => any);
  if (sc) return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      output[key] = stripUndefined(val);
    }
    return output as T;
  }
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
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

function buildSeedUser(userId: string): {
  user: User;
  promos: Promo[];
  wheelSpins: WheelSpin[];
  exposure: UserExposure;
  draftHistory: CompletedDraft[];
  referral: { code: string; createdAt: string };
} {
  const seedUser = seedDb.users['1'];
  const user: User = {
    ...deepClone(seedUser),
    id: userId,
  };
  const promos = deepClone(seedDb.promosByUser['1'] ?? []);
  const wheelSpins = deepClone(seedDb.wheelSpinsByUser['1'] ?? []);
  const exposure: UserExposure = {
    ...deepClone(seedDb.exposureByUser['1'] ?? { username: user.username, totalDrafts: 0, exposures: [] }),
    username: user.username,
  };
  const draftHistory = deepClone(seedDb.draftHistoryByUser['1'] ?? []);
  const referral = deepClone(seedDb.referralsByUser['1'] ?? { code: '', createdAt: todayDate() });

  return { user, promos, wheelSpins, exposure, draftHistory, referral };
}

async function ensureUserSeeded(userId: string): Promise<User> {
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const snap = await userRef.get();
  if (snap.exists) return snap.data() as User;

  const seed = buildSeedUser(userId);
  const batch = db.batch();

  batch.set(userRef, stripUndefined(seed.user));

  for (const promo of seed.promos) {
    const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(promo.id);
    batch.set(promoRef, stripUndefined(promo));
  }

  for (const spin of seed.wheelSpins) {
    const spinRef = userRef.collection(WHEEL_SPINS_SUBCOLLECTION).doc(spin.id);
    batch.set(spinRef, stripUndefined(spin));
  }

  const exposureRef = userRef.collection('metadata').doc(EXPOSURE_DOC);
  batch.set(exposureRef, stripUndefined(seed.exposure));

  for (const draft of seed.draftHistory) {
    const draftRef = userRef.collection(DRAFT_HISTORY_SUBCOLLECTION).doc(draft.id);
    batch.set(draftRef, stripUndefined(draft));
  }

  const referralRef = userRef.collection('metadata').doc(REFERRAL_DOC);
  batch.set(referralRef, stripUndefined(seed.referral));

  // Store reverse lookup for referral code — only if no one else owns it yet
  if (seed.referral.code) {
    const codeRef = db.collection(REFERRAL_CODES_COLLECTION).doc(seed.referral.code);
    const existingCode = await codeRef.get();
    if (!existingCode.exists) {
      batch.set(codeRef, { userId, code: seed.referral.code });
    }
  }

  await batch.commit();
  return seed.user;
}

function calcSpinsForPurchase(quantity: number): number {
  return Math.floor(quantity / API_CONFIG.purchases.spinsPerPasses);
}

function calcBuyBonusFreeDrafts(quantity: number): number {
  if (!API_CONFIG.promos.buyBonus.enabled) return 0;
  return Math.floor(quantity / API_CONFIG.promos.buyBonus.buy) * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
}

export async function getPromos(userId: string): Promise<Promo[]> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const [promosSnap, twitterSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(userId).collection(PROMOS_SUBCOLLECTION).get(),
    db.collection('v2_twitter_links').where('walletAddress', '==', userId.toLowerCase()).limit(1).get(),
  ]);

  const hasVerifiedTwitter = !twitterSnap.empty;

  return promosSnap.docs.map((doc) => {
    const promo = doc.data() as Promo;
    // Inject real twitterConnected status for promos that depend on it
    if (promo.type === 'new-user' || promo.type === 'tweet-engagement') {
      promo.modalContent.twitterConnected = hasVerifiedTwitter;
    }
    return promo;
  });
}

export async function claimPromo(userId: string, promoId: string) {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(promoId);

  return db.runTransaction(async (tx) => {
    const [userSnap, promoSnap] = await Promise.all([tx.get(userRef), tx.get(promoRef)]);
    if (!promoSnap.exists) throw new ApiError(404, 'Promo not found');

    const user = userSnap.data() as User;
    const promo = deepClone(promoSnap.data() as Promo);

    // Gate new-user and tweet-engagement promos behind X verification
    if (promo.type === 'new-user' || promo.type === 'tweet-engagement') {
      const twitterSnap = await db
        .collection('v2_twitter_links')
        .where('walletAddress', '==', userId.toLowerCase())
        .limit(1)
        .get();
      if (twitterSnap.empty) {
        throw new ApiError(400, 'X/Twitter verification required before claiming this promo');
      }
    }

    let spinsAdded = 0;

    if (promo.type === 'pick-10' && promo.modalContent.pick10History) {
      const claimables = promo.modalContent.pick10History.filter((h) => h.status === 'claim');
      spinsAdded = claimables.length;
      promo.modalContent.pick10History = promo.modalContent.pick10History.map((h) =>
        h.status === 'claim' ? { ...h, status: 'claimed' } : h
      );
    } else if (promo.type === 'referral' && promo.modalContent.referralHistory) {
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

    // Buy-bonus awards free drafts, everything else awards wheel spins
    if (promo.type === 'buy-bonus') {
      user.freeDrafts = (user.freeDrafts || 0) + spinsAdded * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
    } else {
      user.wheelSpins = (user.wheelSpins || 0) + spinsAdded;
    }
    promo.claimable = false;
    promo.claimCount = 0;
    // Reset progress after claiming so next cycle starts at 0
    if (promo.progressMax !== undefined) {
      promo.progressCurrent = 0;
    }

    tx.set(userRef, stripUndefined(user), { merge: true });
    tx.set(promoRef, stripUndefined(promo), { merge: true });

    return { promo: deepClone(promo), spinsAdded, user: deepClone(user) };
  });
}

export async function updatePromo(userId: string, promoId: string, patch: Partial<Pick<Promo, 'claimable' | 'claimCount'>>) {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db.collection(USERS_COLLECTION).doc(userId).collection(PROMOS_SUBCOLLECTION).doc(promoId);
  const promoSnap = await promoRef.get();
  if (!promoSnap.exists) throw new ApiError(404, 'Promo not found');

  const promo = deepClone(promoSnap.data() as Promo);
  if (patch.claimable !== undefined) promo.claimable = patch.claimable;
  if (patch.claimCount !== undefined) promo.claimCount = patch.claimCount;

  await promoRef.set(stripUndefined(promo), { merge: true });
  return deepClone(promo);
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const [referralSnap, promosSnap] = await Promise.all([
    userRef.collection('metadata').doc(REFERRAL_DOC).get(),
    userRef.collection(PROMOS_SUBCOLLECTION).get(),
  ]);

  const promos = promosSnap.docs.map((doc) => doc.data() as Promo);
  const referralPromo = promos.find((p) => p.type === 'referral');
  const referralData = referralSnap.exists ? (referralSnap.data() as { code: string; createdAt: string }) : { code: '', createdAt: todayDate() };

  const code = (referralData.code || referralPromo?.modalContent.inviteCode || '').trim();
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
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const base = (username || `USER-${userId}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const code = `BANANA-${base}-${suffix}`;
  const link = `https://banana-fantasy-sbs.vercel.app?ref=${code}`;

  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const referralRef = userRef.collection('metadata').doc(REFERRAL_DOC);
  const codeRef = db.collection(REFERRAL_CODES_COLLECTION).doc(code);

  await db.runTransaction(async (tx) => {
    const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));
    const referralPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');

    tx.set(referralRef, stripUndefined({ code, createdAt: todayDate() }), { merge: true });
    tx.set(codeRef, { userId, code });

    if (referralPromoDoc) {
      const promo = deepClone(referralPromoDoc.data() as Promo);
      promo.modalContent.inviteCode = code;
      promo.modalContent.referralLink = link;
      tx.set(referralPromoDoc.ref, stripUndefined(promo), { merge: true });
    }
  });

  return { code, link };
}

export async function trackReferral(referrerUserId: string, referredUserId: string, referredUsername: string) {
  const db = getAdminFirestore();
  await ensureUserSeeded(referrerUserId);
  await ensureUserSeeded(referredUserId);

  const referrerRef = db.collection(USERS_COLLECTION).doc(referrerUserId);
  const referredRef = db.collection(USERS_COLLECTION).doc(referredUserId);

  return db.runTransaction(async (tx) => {
    // ALL READS FIRST (Firestore requirement)
    const referredSnap = await tx.get(referredRef);
    const promosSnap = await tx.get(referrerRef.collection(PROMOS_SUBCOLLECTION));

    // Process referred user
    const referredUser = referredSnap.data() as User;
    referredUser.referredBy = referrerUserId;

    // Find referrer's referral promo
    const referralPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');
    if (!referralPromoDoc) return { success: false };

    const promo = deepClone(referralPromoDoc.data() as Promo);
    if (!promo.modalContent.referralHistory) {
      promo.modalContent.referralHistory = [];
    }

    // Don't add duplicate entries
    const exists = promo.modalContent.referralHistory.some(
      (e: ReferralEntry) => e.referredUserId === referredUserId
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
    promo.modalContent.referralHistory.push(entry);

    // ALL WRITES AFTER READS
    tx.set(referredRef, stripUndefined(referredUser), { merge: true });
    tx.set(referralPromoDoc.ref, stripUndefined(promo), { merge: true });
    return { success: true };
  });
}

export async function updateReferralRewards(referredUserId: string, milestone: keyof ReferralEntryRewards) {
  const db = getAdminFirestore();
  await ensureUserSeeded(referredUserId);

  const referredRef = db.collection(USERS_COLLECTION).doc(referredUserId);
  const referredSnap = await referredRef.get();
  const referredUser = referredSnap.data() as User;
  if (!referredUser?.referredBy) return { updated: false };

  const referrerUserId = referredUser.referredBy;
  await ensureUserSeeded(referrerUserId);

  const referrerRef = db.collection(USERS_COLLECTION).doc(referrerUserId);

  return db.runTransaction(async (tx) => {
    const promosSnap = await tx.get(referrerRef.collection(PROMOS_SUBCOLLECTION));
    const referralPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');
    if (!referralPromoDoc) return { updated: false };

    const promo = deepClone(referralPromoDoc.data() as Promo);
    if (!promo.modalContent.referralHistory) return { updated: false };

    const entry = promo.modalContent.referralHistory.find(
      (e: ReferralEntry) => e.referredUserId === referredUserId
    );
    if (!entry?.rewards) return { updated: false };

    // Only upgrade from 'pending' to 'claim'
    if (entry.rewards[milestone] !== 'pending') return { updated: false };

    entry.rewards[milestone] = 'claim';
    entry.status = 'claim';
    promo.claimCount = (promo.claimCount || 0) + 1;
    promo.claimable = true;

    tx.set(referralPromoDoc.ref, stripUndefined(promo), { merge: true });
    return { updated: true, referrerUserId };
  });
}

export async function spinWheel(userId: string): Promise<{ spin: WheelSpin; user: User }> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const userRef = db.collection(USERS_COLLECTION).doc(userId);

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const user = userSnap.data() as User;

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

    const spinRef = userRef.collection(WHEEL_SPINS_SUBCOLLECTION).doc(spin.id);
    tx.set(spinRef, stripUndefined(spin));
    tx.set(userRef, stripUndefined(user), { merge: true });

    return { spin: deepClone(spin), user: deepClone(user) };
  });
}

export async function getWheelHistory(userId: string): Promise<WheelSpin[]> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const historySnap = await db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(WHEEL_SPINS_SUBCOLLECTION)
    .orderBy('date', 'desc')
    .get();

  return historySnap.docs.map((doc) => doc.data() as WheelSpin);
}

export async function createPurchase(
  userId: string,
  quantity: number,
  paymentMethod: Purchase['paymentMethod']
): Promise<PurchaseCreateResponse> {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(400, 'quantity must be a positive integer');

  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

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

  await db.collection(PURCHASES_COLLECTION).doc(purchase.id).set(stripUndefined(purchase));

  const payment: PurchasePaymentInstructions = {
    toAddress: API_CONFIG.purchases.usdc.toAddress,
    chainId: API_CONFIG.purchases.usdc.chainId,
    tokenAddress: API_CONFIG.purchases.usdc.tokenAddress,
    amount: String(totalPrice),
    decimals: API_CONFIG.purchases.usdc.decimals,
  };

  return { purchase: deepClone(purchase), payment };
}

export async function verifyPurchase(purchaseId: string, txHash: string) {
  const db = getAdminFirestore();

  const purchaseRef = db.collection(PURCHASES_COLLECTION).doc(purchaseId);
  const preSnap = await purchaseRef.get();
  if (!preSnap.exists) throw new ApiError(404, 'Purchase not found');
  const prePurchase = preSnap.data() as Purchase;

  await ensureUserSeeded(prePurchase.userId);
  const userRef = db.collection(USERS_COLLECTION).doc(prePurchase.userId);

  return db.runTransaction(async (tx) => {
    const purchaseSnap = await tx.get(purchaseRef);
    if (!purchaseSnap.exists) throw new ApiError(404, 'Purchase not found');
    const purchase = purchaseSnap.data() as Purchase;

    const userSnap = await tx.get(userRef);
    const user = userSnap.data() as User;

    if (purchase.status === 'completed') {
      return {
        purchase: deepClone(purchase),
        user: deepClone(user),
        spinsAdded: 0,
        draftPassesAdded: 0,
        freeDraftsAdded: 0,
      };
    }
    if (purchase.status !== 'pending') throw new ApiError(400, `Purchase cannot be verified from status: ${purchase.status}`);

    purchase.status = 'completed';
    purchase.verifiedAt = nowIso();
    purchase.txHash = txHash;

    const draftPassesAdded = purchase.quantity;
    user.draftPasses = (user.draftPasses || 0) + draftPassesAdded;

    const spinsAdded = calcSpinsForPurchase(purchase.quantity);
    user.wheelSpins = (user.wheelSpins || 0) + spinsAdded;

    let freeDraftsAdded = calcBuyBonusFreeDrafts(purchase.quantity);
    user.freeDrafts = (user.freeDrafts || 0) + freeDraftsAdded;

    const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));
    const mintPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'mint');
    if (mintPromoDoc) {
      const mintPromo = deepClone(mintPromoDoc.data() as Promo);
      mintPromo.modalContent.totalMinted = (mintPromo.modalContent.totalMinted || 0) + purchase.quantity;
      const max = mintPromo.progressMax || 10;
      const current = mintPromo.progressCurrent || 0;
      const newTotal = current + purchase.quantity;
      const newlyEarned = Math.floor(newTotal / max);
      // Keep progress at max when a milestone is hit (shows 10/10).
      // Only carry over the remainder if there's leftover beyond the milestone.
      const remainder = newTotal % max;
      mintPromo.progressCurrent = (newlyEarned > 0 && remainder === 0) ? max : remainder;
      if (newlyEarned > 0) {
        mintPromo.claimCount = (mintPromo.claimCount || 0) + newlyEarned;
        recalcPromoClaimable(mintPromo);
      }
      tx.set(mintPromoDoc.ref, stripUndefined(mintPromo), { merge: true });
    }

    // Buy-bonus promo progress
    const buyBonusDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'buy-bonus');
    if (buyBonusDoc) {
      const buyBonusPromo = deepClone(buyBonusDoc.data() as Promo);
      const bbMax = buyBonusPromo.progressMax || 2;
      const bbCurrent = buyBonusPromo.progressCurrent || 0;
      const bbNewTotal = bbCurrent + purchase.quantity;
      const bbNewlyEarned = Math.floor(bbNewTotal / bbMax);
      const bbRemainder = bbNewTotal % bbMax;
      buyBonusPromo.progressCurrent = (bbNewlyEarned > 0 && bbRemainder === 0) ? bbMax : bbRemainder;
      if (bbNewlyEarned > 0) {
        buyBonusPromo.claimCount = (buyBonusPromo.claimCount || 0) + bbNewlyEarned;
        recalcPromoClaimable(buyBonusPromo);
        freeDraftsAdded = bbNewlyEarned * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
      }
      tx.set(buyBonusDoc.ref, stripUndefined(buyBonusPromo), { merge: true });
    }

    // Referral purchase milestones
    if (user.referredBy) {
      const referrerRef = db.collection(USERS_COLLECTION).doc(user.referredBy);
      const referrerPromosSnap = await tx.get(referrerRef.collection(PROMOS_SUBCOLLECTION));
      const referralPromoDoc = referrerPromosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');
      if (referralPromoDoc) {
        const referralPromo = deepClone(referralPromoDoc.data() as Promo);
        if (referralPromo.modalContent.referralHistory) {
          // Count total completed purchases for this user
          const allPurchasesSnap = await db.collection(PURCHASES_COLLECTION)
            .where('userId', '==', purchase.userId)
            .where('status', '==', 'completed')
            .get();
          const totalPurchases = allPurchasesSnap.size + 1; // +1 for the current one being completed

          const entry = referralPromo.modalContent.referralHistory.find(
            (e: ReferralEntry) => e.referredUserId === purchase.userId
          );
          if (entry) {
            entry.draftsPurchased = totalPurchases;
            if (totalPurchases >= 1 && entry.rewards?.bought1 === 'pending') {
              entry.rewards.bought1 = 'claim';
              entry.status = 'claim';
              referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
              referralPromo.claimable = true;
            }
            if (totalPurchases >= 10 && entry.rewards?.bought10 === 'pending') {
              entry.rewards.bought10 = 'claim';
              entry.status = 'claim';
              referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
              referralPromo.claimable = true;
            }
          }
          tx.set(referralPromoDoc.ref, stripUndefined(referralPromo), { merge: true });
        }
      }
    }

    tx.set(purchaseRef, stripUndefined(purchase), { merge: true });
    tx.set(userRef, stripUndefined(user), { merge: true });

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
  const db = getAdminFirestore();

  const purchasesSnap = await db
    .collection(PURCHASES_COLLECTION)
    .where('userId', '==', userId)
    .get();

  return purchasesSnap.docs.map((doc) => doc.data() as Purchase);
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

  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

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

  await db.collection(WITHDRAWALS_COLLECTION).doc(withdrawal.id).set(stripUndefined(withdrawal));
  return deepClone(withdrawal);
}

export async function getWithdrawalsByUser(userId: string): Promise<PrizeWithdrawal[]> {
  const db = getAdminFirestore();

  const withdrawalsSnap = await db
    .collection(WITHDRAWALS_COLLECTION)
    .where('userId', '==', userId)
    .get();

  return withdrawalsSnap.docs.map((doc) => doc.data() as PrizeWithdrawal);
}

export async function getContests(): Promise<Contest[]> {
  const db = getAdminFirestore();
  const contestsSnap = await db.collection(CONTESTS_COLLECTION).get();

  // Seed contests from seed data if Firestore has none
  if (contestsSnap.empty && seedDb.contests.length > 0) {
    const batch = db.batch();
    for (const contest of seedDb.contests) {
      const contestRef = db.collection(CONTESTS_COLLECTION).doc(contest.id);
      batch.set(contestRef, stripUndefined(contest));
      // Seed standings
      const standings = seedDb.standingsByContestId[contest.id] ?? [];
      for (const entry of standings) {
        const standingRef = contestRef.collection(STANDINGS_SUBCOLLECTION).doc(String(entry.rank));
        batch.set(standingRef, stripUndefined(entry));
      }
    }
    await batch.commit();
    return deepClone(seedDb.contests);
  }

  return contestsSnap.docs.map((doc) => doc.data() as Contest);
}

export async function getContest(contestId: string): Promise<Contest | null> {
  const db = getAdminFirestore();
  const contestSnap = await db.collection(CONTESTS_COLLECTION).doc(contestId).get();
  if (!contestSnap.exists) return null;
  return contestSnap.data() as Contest;
}

export async function getContestStandings(contestId: string): Promise<LeaderboardEntry[]> {
  const db = getAdminFirestore();
  const standingsSnap = await db
    .collection(CONTESTS_COLLECTION)
    .doc(contestId)
    .collection(STANDINGS_SUBCOLLECTION)
    .orderBy('rank', 'asc')
    .get();

  return standingsSnap.docs.map((doc) => doc.data() as LeaderboardEntry);
}

export async function getExposure(userId: string): Promise<UserExposure | null> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const exposureSnap = await db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection('metadata')
    .doc(EXPOSURE_DOC)
    .get();

  if (!exposureSnap.exists) return null;
  return exposureSnap.data() as UserExposure;
}

export async function getDraftHistory(userId: string): Promise<CompletedDraft[]> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const historySnap = await db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(DRAFT_HISTORY_SUBCOLLECTION)
    .orderBy('completedDate', 'desc')
    .get();

  return historySnap.docs.map((doc) => doc.data() as CompletedDraft);
}
