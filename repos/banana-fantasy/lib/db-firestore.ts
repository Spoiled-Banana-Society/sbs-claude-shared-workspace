import crypto from 'node:crypto';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { API_CONFIG, getUsdcPaymentAddressOrThrow } from '@/lib/api/config';
import { ApiError } from '@/lib/api/errors';
import { seedDb } from '@/lib/api/seed';
import { logger } from '@/lib/logger';
import { verifyPurchaseTx } from '@/lib/onchain/verifyPurchaseTx';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { logActivityEvent } from '@/lib/activityEvents';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  CompletedDraft,
  Contest,
  DraftQueue,
  LeaderboardEntry,
  QueueRound,
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
const PERSONA_COLLECTION = 'personaVerifications';
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

/**
 * Deterministic per-user referral code so each freshly-seeded user gets
 * their own code (instead of every user inheriting the seed template's
 * shared `BANANA-CK99-2026`). Using sha256(userId) so re-seeds are stable
 * — same wallet always maps to the same code.
 */
function buildPerUserReferralCode(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId.toLowerCase()).digest('hex').toUpperCase();
  return `BANANA-${hash.slice(0, 4)}-${hash.slice(4, 8)}`;
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
  // IMPORTANT: override mock-template fields with real per-user values.
  // Without these overrides every new user ends up with seedUser1's mock
  // walletAddress/username/createdAt/etc., which is why the admin page
  // showed 156 users all with `0x1234...5678`.
  const user: User = {
    ...deepClone(seedUser),
    id: userId,
    walletAddress: userId,
    username: `User-${userId.slice(0, 6)}`,
    xHandle: undefined,
    profilePicture: undefined,
    nflTeam: undefined,
    createdAt: new Date().toISOString(),
    wheelSpins: 0,
    freeDrafts: 0,
    jackpotEntries: 0,
    hofEntries: 0,
    draftPasses: 0,
    usdcBalance: 0,
    cardPurchaseCount: 0,
    isVerified: false,
  };
  const promos = deepClone(seedDb.promosByUser['1'] ?? []);

  // Override the referral promo's inviteCode/referralLink — seed template
  // hardcodes a shared code which used to leak everyone's referrals to the
  // first-seeded user.
  const code = buildPerUserReferralCode(userId);
  const link = `https://banana-fantasy-sbs.vercel.app?ref=${code}`;
  const referralPromo = promos.find((p) => p.type === 'referral');
  if (referralPromo) {
    referralPromo.modalContent.inviteCode = code;
    referralPromo.modalContent.referralLink = link;
  }

  const wheelSpins = deepClone(seedDb.wheelSpinsByUser['1'] ?? []);
  const exposure: UserExposure = {
    ...deepClone(seedDb.exposureByUser['1'] ?? { username: user.username, totalDrafts: 0, exposures: [] }),
    username: user.username,
  };
  const draftHistory = deepClone(seedDb.draftHistoryByUser['1'] ?? []);
  const referral = { code, createdAt: todayDate() };

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

  // Fire-and-forget signup event (first-time seed)
  try {
    const { logUserEvent } = await import('@/lib/userEvents');
    void logUserEvent(userId, 'signup');
  } catch {
    // non-fatal
  }

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

  const userRef = db.collection(USERS_COLLECTION).doc(userId);

  const [promosSnap, twitterSnap] = await Promise.all([
    userRef.collection(PROMOS_SUBCOLLECTION).get(),
    db.collection('v2_twitter_links').where('walletAddress', '==', userId.toLowerCase()).limit(1).get(),
  ]);

  const hasVerifiedTwitter = !twitterSnap.empty;
  const newUserPromoAlreadyClaimed = hasVerifiedTwitter
    ? (twitterSnap.docs[0].data().newUserPromoClaimed ?? false)
    : false;

  // Lazy backfill: if seeded promo list has entries this user is missing
  // (e.g. new promos added after the user was seeded), insert them now.
  const existingIds = new Set(promosSnap.docs.map((d) => d.id));
  const seedList = seedDb.promosByUser['1'] ?? [];
  const missing = seedList.filter((p) => !existingIds.has(p.id));
  if (missing.length > 0) {
    const batch = db.batch();
    for (const promo of missing) {
      const ref = userRef.collection(PROMOS_SUBCOLLECTION).doc(promo.id);
      batch.set(ref, stripUndefined(deepClone(promo)));
    }
    await batch.commit();
  }

  const allDocs = missing.length > 0
    ? [...promosSnap.docs.map((d) => d.data() as Promo), ...missing.map((p) => deepClone(p))]
    : promosSnap.docs.map((d) => d.data() as Promo);

  // Backfill: existing users were seeded with a hardcoded shared inviteCode
  // (seedDb.referralsByUser['1'] = 'BANANA-CK99-2026'). Replace with a
  // per-user deterministic code on read AND persist + claim the reverse
  // lookup doc so /api/referrals/track resolves to this user.
  const expectedCode = buildPerUserReferralCode(userId);
  const expectedLink = `https://banana-fantasy-sbs.vercel.app?ref=${expectedCode}`;
  const referralPromoToFix = allDocs.find(
    (p) => p.type === 'referral' && p.modalContent.inviteCode !== expectedCode,
  );
  if (referralPromoToFix) {
    referralPromoToFix.modalContent.inviteCode = expectedCode;
    referralPromoToFix.modalContent.referralLink = expectedLink;
    // Fire-and-forget: persist the fix + reverse-lookup doc, plus update
    // the metadata/referral doc. Don't block the response on it.
    void (async () => {
      try {
        const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(referralPromoToFix.id);
        const referralMetaRef = userRef.collection('metadata').doc(REFERRAL_DOC);
        const codeRef = db.collection(REFERRAL_CODES_COLLECTION).doc(expectedCode);
        const codeSnap = await codeRef.get();
        const batch = db.batch();
        batch.set(
          promoRef,
          { modalContent: { inviteCode: expectedCode, referralLink: expectedLink } },
          { merge: true },
        );
        batch.set(referralMetaRef, { code: expectedCode }, { merge: true });
        if (!codeSnap.exists) {
          batch.set(codeRef, { userId, code: expectedCode });
        }
        await batch.commit();
      } catch {
        /* best-effort backfill */
      }
    })();
  }

  return allDocs.map((promo) => {
    // Inject real twitterConnected status for promos that depend on it
    if (promo.type === 'new-user' || promo.type === 'tweet-engagement') {
      promo.modalContent.twitterConnected = hasVerifiedTwitter;
    }
    // New-user promo unlocks the moment Twitter is verified. Promo doc itself
    // doesn't carry claim state — the v2_twitter_links record's
    // newUserPromoClaimed is the source of truth (so the promo stays
    // claimable across Firestore re-seeds and resists race conditions).
    if (promo.type === 'new-user' && hasVerifiedTwitter && !newUserPromoAlreadyClaimed) {
      promo.claimable = true;
      promo.claimCount = Math.max(promo.claimCount ?? 0, 1);
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
    let twitterLinkRef: FirebaseFirestore.DocumentReference | null = null;
    if (promo.type === 'new-user' || promo.type === 'tweet-engagement') {
      const twitterSnap = await db
        .collection('v2_twitter_links')
        .where('walletAddress', '==', userId.toLowerCase())
        .limit(1)
        .get();
      if (twitterSnap.empty) {
        throw new ApiError(400, 'X/Twitter verification required before claiming this promo');
      }
      twitterLinkRef = twitterSnap.docs[0].ref;
      if (promo.type === 'new-user') {
        // Source of truth for the new-user claim is the twitter link doc, not
        // the promo doc (the promo's `claimable` is flipped on read by getPromos
        // and never persists, so trusting `promo.claimable` here would always
        // throw "not claimable").
        if (twitterSnap.docs[0].data().newUserPromoClaimed) {
          throw new ApiError(400, 'New-user bonus already claimed');
        }
      }
    }

    let spinsAdded = 0;

    if (promo.type === 'new-user') {
      // Single-shot claim — Twitter gate above proved verified-and-unclaimed.
      spinsAdded = 1;
    } else if (promo.type === 'pick-10' && promo.modalContent.pick10History) {
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

    // Buy-bonus awards free drafts, everything else awards wheel spins.
    // When on-chain admin mint is configured, free-draft awards ALSO mint real
    // BBB4 NFTs after the tx commits (dual-write — counter + NFT stay in sync).
    const draftPassCount =
      promo.type === 'buy-bonus'
        ? spinsAdded * API_CONFIG.promos.buyBonus.bonusFreeDrafts
        : 0;
    const mintOnChain = isAdminMintConfigured() && draftPassCount > 0;

    if (draftPassCount > 0) {
      user.freeDrafts = (user.freeDrafts || 0) + draftPassCount;
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
    if (promo.type === 'new-user' && twitterLinkRef) {
      tx.update(twitterLinkRef, { newUserPromoClaimed: true });
    }

    return { promo: deepClone(promo), spinsAdded, user: deepClone(user), draftPassCount, mintOnChain };
  }).then(async (result) => {
    // Post-commit: mint free-draft NFTs for buy-bonus when the ops wallet
    // is wired up. Best-effort — failures land in `failed_mints` for retry.
    if (result.mintOnChain && result.draftPassCount > 0) {
      try {
        const mintRes = await reserveTokensToWallet({ to: userId, count: result.draftPassCount });
        await recordPassOrigins({
          tokenIds: mintRes.tokenIds,
          origin: 'spin_reward',
          ownerAtMint: userId,
          txHash: mintRes.txHash,
          reason: `promo_claim:${promoId}`,
        });
        logger.info('promo.claim.mint_ok', {
          userId,
          promoId,
          count: result.draftPassCount,
          txHash: mintRes.txHash,
          tokenIds: mintRes.tokenIds,
        });
      } catch (mintErr) {
        logger.error('promo.claim.mint_failed', { userId, promoId, err: mintErr });
        try {
          const db2 = getAdminFirestore();
          await db2.collection('failed_mints').doc(`promo_${userId}_${promoId}`).set({
            userId,
            promoId,
            count: result.draftPassCount,
            reason: `promo_claim:${promoId}`,
            error: (mintErr as Error)?.message ?? String(mintErr),
            createdAt: FieldValue.serverTimestamp(),
            retryable: true,
          });
        } catch (logErr) {
          logger.error('promo.claim.failed_mint_record_error', { userId, promoId, err: logErr });
        }
      }
    }

    // Fire-and-forget user event for Metrics dashboard
    try {
      const { logUserEvent } = await import('@/lib/userEvents');
      void logUserEvent(userId, 'promo_claimed', {
        promoId,
        promoType: result.promo.type,
        spinsAdded: result.spinsAdded,
      });
    } catch { /* non-fatal */ }

    await logActivityEvent({
      type: 'promo_claimed',
      userId,
      paymentMethod: 'free',
      quantity: result.draftPassCount > 0 ? result.draftPassCount : result.spinsAdded,
      metadata: {
        promoId,
        promoType: result.promo.type,
        spinsAdded: result.spinsAdded,
        draftPassesAdded: result.draftPassCount,
      },
    });
    return result;
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

    // Process referred user — never overwrite an existing referrer.
    const referredUser = referredSnap.data() as User;
    if (referredUser.referredBy && referredUser.referredBy !== referrerUserId) {
      return { success: false, alreadyReferred: true };
    }
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
    .orderBy('timestamp', 'desc')
    .get();

  // Live spins are stored with `timestamp` + `spinId`; legacy seeded mock
  // entries use `date` + `id`. Normalize both into the `WheelSpin` shape so
  // client-side callers don't need to know which vintage a row is.
  return historySnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const date = (data.timestamp as string) || (data.date as string) || '';
    const id = (data.spinId as string) || (data.id as string) || doc.id;
    return {
      id,
      spinId: id,
      date,
      prize: data.prize as WheelPrize,
      claimed: Boolean(data.claimed),
      result: (data.result as string) || '',
    } as WheelSpin & { spinId: string; result: string };
  });
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
    toAddress: getUsdcPaymentAddressOrThrow(),
    chainId: API_CONFIG.purchases.usdc.chainId,
    tokenAddress: API_CONFIG.purchases.usdc.tokenAddress,
    amount: String(totalPrice),
    decimals: API_CONFIG.purchases.usdc.decimals,
  };

  return { purchase: deepClone(purchase), payment };
}

/**
 * Bumps mint promo (Buy 10 → Spin) and buy-bonus promo (Buy 2 → 1 Free)
 * progress for a wallet that just minted N passes. Runs inside the caller's
 * transaction. Returns milestones earned per promo so the caller can react
 * (e.g. credit bonus free drafts on the user doc). Idempotency is the
 * caller's responsibility — don't invoke twice for the same mint event.
 */
async function _incrementMintPromosInTx(
  tx: FirebaseFirestore.Transaction,
  userRef: FirebaseFirestore.DocumentReference,
  quantity: number,
): Promise<{ mintMilestonesEarned: number; buyBonusMilestonesEarned: number }> {
  const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));

  let mintMilestonesEarned = 0;
  const mintPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'mint');
  if (mintPromoDoc) {
    const mintPromo = deepClone(mintPromoDoc.data() as Promo);
    mintPromo.modalContent.totalMinted = (mintPromo.modalContent.totalMinted || 0) + quantity;
    const max = mintPromo.progressMax || 10;
    const current = mintPromo.progressCurrent || 0;
    const newTotal = current + quantity;
    const newlyEarned = Math.floor(newTotal / max);
    const remainder = newTotal % max;
    mintPromo.progressCurrent = (newlyEarned > 0 && remainder === 0) ? max : remainder;
    if (newlyEarned > 0) {
      mintPromo.claimCount = (mintPromo.claimCount || 0) + newlyEarned;
      recalcPromoClaimable(mintPromo);
      mintMilestonesEarned = newlyEarned;
    }
    tx.set(mintPromoDoc.ref, stripUndefined(mintPromo), { merge: true });
  }

  let buyBonusMilestonesEarned = 0;
  const buyBonusDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'buy-bonus');
  if (buyBonusDoc) {
    const buyBonusPromo = deepClone(buyBonusDoc.data() as Promo);
    const bbMax = buyBonusPromo.progressMax || 2;
    const bbCurrent = buyBonusPromo.progressCurrent || 0;
    const bbNewTotal = bbCurrent + quantity;
    const bbNewlyEarned = Math.floor(bbNewTotal / bbMax);
    const bbRemainder = bbNewTotal % bbMax;
    buyBonusPromo.progressCurrent = (bbNewlyEarned > 0 && bbRemainder === 0) ? bbMax : bbRemainder;
    if (bbNewlyEarned > 0) {
      buyBonusPromo.claimCount = (buyBonusPromo.claimCount || 0) + bbNewlyEarned;
      recalcPromoClaimable(buyBonusPromo);
      buyBonusMilestonesEarned = bbNewlyEarned;
    }
    tx.set(buyBonusDoc.ref, stripUndefined(buyBonusPromo), { merge: true });
  }

  return { mintMilestonesEarned, buyBonusMilestonesEarned };
}

/**
 * Public wrapper for routes that don't already have a transaction running.
 * Used by staging-mint and card-mint, which write `draftPasses` directly
 * (no purchase doc). For the legacy `verifyPurchase` flow the inner helper
 * is invoked inside the existing transaction.
 */
export async function incrementMintPromos(
  userId: string,
  quantity: number,
): Promise<{ mintMilestonesEarned: number; buyBonusMilestonesEarned: number }> {
  if (quantity <= 0) return { mintMilestonesEarned: 0, buyBonusMilestonesEarned: 0 };
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  return db.runTransaction((tx) => _incrementMintPromosInTx(tx, userRef, quantity));
}

/**
 * Bumps the referrer's referral promo when their referee mints/buys passes.
 * Bumps `draftsPurchased` by `quantity` and fires bought1 / bought10
 * milestones when crossed.
 *
 * Behavior note: the legacy verifyPurchase counted completed purchase docs
 * (1 per tx regardless of quantity); this helper counts actual passes.
 * One mint of 10 passes now advances the referrer past bought10 in a single
 * shot, instead of needing 10 separate purchases.
 *
 * Returns the number of newly-fired milestones (0, 1, or 2 — bought1 + bought10).
 */
async function _incrementReferralPromosInTx(
  tx: FirebaseFirestore.Transaction,
  buyerUser: User,
  buyerUserId: string,
  quantity: number,
): Promise<{ referralMilestonesEarned: number }> {
  if (!buyerUser.referredBy) return { referralMilestonesEarned: 0 };

  const db = getAdminFirestore();
  const referrerRef = db.collection(USERS_COLLECTION).doc(buyerUser.referredBy);
  const referrerPromosSnap = await tx.get(referrerRef.collection(PROMOS_SUBCOLLECTION));
  const referralPromoDoc = referrerPromosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');
  if (!referralPromoDoc) return { referralMilestonesEarned: 0 };

  const referralPromo = deepClone(referralPromoDoc.data() as Promo);
  if (!referralPromo.modalContent.referralHistory) return { referralMilestonesEarned: 0 };

  const entry = referralPromo.modalContent.referralHistory.find(
    (e: ReferralEntry) => e.referredUserId === buyerUserId,
  );
  if (!entry) return { referralMilestonesEarned: 0 };

  let milestonesEarned = 0;
  entry.draftsPurchased = (entry.draftsPurchased || 0) + quantity;

  if (entry.draftsPurchased >= 1 && entry.rewards?.bought1 === 'pending') {
    entry.rewards.bought1 = 'claim';
    entry.status = 'claim';
    referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
    referralPromo.claimable = true;
    milestonesEarned += 1;
  }
  if (entry.draftsPurchased >= 10 && entry.rewards?.bought10 === 'pending') {
    entry.rewards.bought10 = 'claim';
    entry.status = 'claim';
    referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
    referralPromo.claimable = true;
    milestonesEarned += 1;
  }

  tx.set(referralPromoDoc.ref, stripUndefined(referralPromo), { merge: true });
  return { referralMilestonesEarned: milestonesEarned };
}

export async function incrementReferralPromos(
  buyerUserId: string,
  quantity: number,
): Promise<{ referralMilestonesEarned: number }> {
  if (quantity <= 0) return { referralMilestonesEarned: 0 };
  const db = getAdminFirestore();
  await ensureUserSeeded(buyerUserId);
  const userRef = db.collection(USERS_COLLECTION).doc(buyerUserId);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return { referralMilestonesEarned: 0 };
    const buyerUser = userSnap.data() as User;
    return _incrementReferralPromosInTx(tx, buyerUser, buyerUserId, quantity);
  });
}

export async function verifyPurchase(purchaseId: string, txHash: string) {
  const db = getAdminFirestore();

  const purchaseRef = db.collection(PURCHASES_COLLECTION).doc(purchaseId);
  const preSnap = await purchaseRef.get();
  if (!preSnap.exists) throw new ApiError(404, 'Purchase not found');
  const prePurchase = preSnap.data() as Purchase;

  await ensureUserSeeded(prePurchase.userId);
  const userRef = db.collection(USERS_COLLECTION).doc(prePurchase.userId);

  // Idempotent short-circuit: already completed → return existing state.
  if (prePurchase.status === 'completed') {
    const userSnap = await userRef.get();
    return {
      purchase: deepClone(prePurchase),
      user: deepClone(userSnap.data() as User),
      spinsAdded: 0,
      draftPassesAdded: 0,
      freeDraftsAdded: 0,
    };
  }

  // On-chain verification (skipped only for completed short-circuit above).
  const userSnapPre = await userRef.get();
  const userPre = userSnapPre.data() as User | undefined;
  const expectedFrom = userPre?.walletAddress || prePurchase.userId;
  if (!expectedFrom) throw new ApiError(400, 'No wallet address on user');

  // Replay guard: the same txHash cannot verify two purchases.
  const dupSnap = await db
    .collection(PURCHASES_COLLECTION)
    .where('txHash', '==', txHash)
    .where('status', '==', 'completed')
    .limit(1)
    .get();
  if (!dupSnap.empty && dupSnap.docs[0].id !== purchaseId) {
    throw new ApiError(400, 'This transaction has already been credited to another purchase');
  }

  let mintInfo;
  try {
    mintInfo = await verifyPurchaseTx({
      txHash,
      expectedFrom,
      expectedQuantity: prePurchase.quantity,
    });
  } catch (verifyErr) {
    // Verify rejected the tx. Surface it so admin can investigate + retry.
    // If the user's BBB4 balance reflects the mint anyway, this is a sync
    // issue (not a theft). We record the failure so nothing is silently lost.
    try {
      await db.collection('failed_mints').doc(purchaseId).set({
        purchaseId,
        userId: prePurchase.userId,
        wallet: expectedFrom.toLowerCase(),
        quantity: prePurchase.quantity,
        txHash,
        reason: 'verify_rejected',
        error: (verifyErr as Error)?.message ?? String(verifyErr),
        createdAt: FieldValue.serverTimestamp(),
        retryable: true,
        source: 'purchase_verify',
      });
    } catch (logErr) {
      logger.error('verifyPurchase.failed_mint_record_error', { purchaseId, err: logErr });
    }
    throw verifyErr;
  }

  // Record the minted tokenIds in the Go API so `/owner/{wallet}/draftToken/all`
  // returns them as available passes. BBB4.mint is sequential so tokenIds are
  // always contiguous within a single tx → minId/maxId range is exact.
  // Best-effort — if the Go API rejects (e.g. already recorded from a retry),
  // log and continue. The on-chain mint is the source of truth.
  try {
    const ids = mintInfo.tokenIds.map((t) => Number.parseInt(t, 10)).filter((n) => Number.isFinite(n));
    if (ids.length > 0) {
      const minId = Math.min(...ids);
      const maxId = Math.max(...ids);
      const apiBase = process.env.NEXT_PUBLIC_DRAFTS_API_URL?.trim();
      if (apiBase) {
        const res = await fetch(`${apiBase}/owner/${expectedFrom.toLowerCase()}/draftToken/mint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minId, maxId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logger.warn('verifyPurchase.record_tokens_failed', { status: res.status, body: text.slice(0, 200), txHash });
        } else {
          logger.info('verifyPurchase.record_tokens_ok', { minId, maxId, wallet: expectedFrom, txHash });
        }
      } else {
        logger.warn('verifyPurchase.drafts_api_url_missing');
      }
    }
  } catch (err) {
    logger.warn('verifyPurchase.record_tokens_error', { err: (err as Error).message, txHash });
  }

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

    // draftPasses is NOT incremented here. On-chain BBB4 balanceOf is the
    // source of truth — see app/api/owner/balance/route.ts, which reads
    // Alchemy and writes the count through to Firestore. Dual-writing here
    // caused drift (counter ballooning across many test purchases, never
    // decrementing on use).
    const draftPassesAdded = purchase.quantity;

    const spinsAdded = calcSpinsForPurchase(purchase.quantity);
    user.wheelSpins = (user.wheelSpins || 0) + spinsAdded;

    let freeDraftsAdded = calcBuyBonusFreeDrafts(purchase.quantity);
    user.freeDrafts = (user.freeDrafts || 0) + freeDraftsAdded;

    const { buyBonusMilestonesEarned } = await _incrementMintPromosInTx(tx, userRef, purchase.quantity);
    if (buyBonusMilestonesEarned > 0) {
      freeDraftsAdded = buyBonusMilestonesEarned * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
    }

    await _incrementReferralPromosInTx(tx, user, purchase.userId, purchase.quantity);

    // Card Purchase Rewards: every 6 card purchases = 1 free draft
    let freePassFromRewards = false;
    if (purchase.paymentMethod === 'card') {
      user.cardPurchaseCount = (user.cardPurchaseCount || 0) + 1;
      if (user.cardPurchaseCount >= 6) {
        user.cardPurchaseCount = 0;
        user.freeDrafts = (user.freeDrafts || 0) + 1;
        freeDraftsAdded += 1;
        freePassFromRewards = true;
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
      freePassFromRewards,
    };
  }).then(async (result) => {
    // Record activity for the paid-mint. Done outside the transaction so
    // a write failure here never rolls back the user credit.
    await logActivityEvent({
      type: 'pass_purchased',
      userId: prePurchase.userId,
      walletAddress: expectedFrom,
      paymentMethod: prePurchase.paymentMethod,
      quantity: prePurchase.quantity,
      tokenIds: mintInfo.tokenIds,
      txHash,
      metadata: {
        purchaseId,
        unitPrice: prePurchase.unitPrice,
        totalPrice: prePurchase.totalPrice,
        currency: prePurchase.currency,
        freeDraftsAdded: result.freeDraftsAdded,
        spinsAdded: result.spinsAdded,
      },
    });
    return result;
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

// ==================== SPECIAL DRAFT QUEUES (Jackpot / HOF) ====================
// All special drafts are slow (8-hour). One queue per type.
// When a round fills to 10, draft starts immediately.

const QUEUES_COLLECTION = 'v2_queues';
const QUEUE_MAX = 10;

function emptyQueueDoc(type: 'jackpot' | 'hof'): DraftQueue {
  return { type, rounds: [], nextRoundId: 1 };
}

function newRound(roundId: number): QueueRound {
  return { roundId, members: [], status: 'filling', draftId: null };
}

export async function getQueueStatus(): Promise<Record<string, DraftQueue>> {
  const db = getAdminFirestore();
  const ids = ['jackpot', 'hof'] as const;
  const snaps = await Promise.all(ids.map(id => db.collection(QUEUES_COLLECTION).doc(id).get()));
  const result: Record<string, DraftQueue> = {};
  for (let i = 0; i < ids.length; i++) {
    if (snaps[i].exists) {
      const data = snaps[i].data() as DraftQueue;
      if (!data.rounds) data.rounds = [];
      result[ids[i]] = data;
    } else {
      result[ids[i]] = emptyQueueDoc(ids[i]);
    }
  }
  return result;
}

/**
 * Join queue with ALL available entries for a type.
 * Each entry goes to a separate round (user never twice in same round).
 * Called automatically when user wins JP/HOF on the wheel.
 * When a round fills to 10, status changes to 'ready' (draft starts immediately).
 */
export async function joinQueue(
  userId: string,
  type: 'jackpot' | 'hof',
): Promise<DraftQueue> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  return db.runTransaction(async (tx) => {
    const [userSnap, queueSnap] = await Promise.all([tx.get(userRef), tx.get(queueRef)]);
    const user = userSnap.data() as User;
    const queue: DraftQueue = queueSnap.exists ? (queueSnap.data() as DraftQueue) : emptyQueueDoc(type);
    if (!queue.rounds) queue.rounds = [];

    const entryField = type === 'jackpot' ? 'jackpotEntries' : 'hofEntries';
    const entries = (user as unknown as Record<string, unknown>)[entryField] as number || 0;
    if (entries <= 0) throw new ApiError(400, `No ${type} entries available`);

    // Consume entries
    tx.set(userRef, { [entryField]: 0 }, { merge: true });

    // Add new entries to next available rounds (don't touch existing rounds)
    for (let i = 0; i < entries; i++) {
      let round = queue.rounds.find(
        r => r.status === 'filling' && r.members.length < QUEUE_MAX && !r.members.some(m => m.wallet === userId),
      );
      if (!round) {
        round = newRound(queue.nextRoundId++);
        queue.rounds.push(round);
      }
      round.members.push({ wallet: userId, joinedAt: Date.now() });

      // Note: status stays 'filling' — the Firebase trigger handles creating the draft
      // on the 1st member and setting status to 'drafting' at 10/10.
    }

    tx.set(queueRef, queue);
    return queue;
  });
}

/**
 * Update a queue round's draftId. Called when the frontend creates a Go API draft
 * for a special draft round that doesn't have one yet.
 */
export async function updateQueueRoundDraftId(
  type: 'jackpot' | 'hof',
  roundId: number,
  draftId: string,
): Promise<void> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) throw new ApiError(404, 'Queue not found');
    const queue = snap.data() as DraftQueue;
    if (!queue.rounds) throw new ApiError(404, 'No rounds in queue');

    const round = queue.rounds.find(r => r.roundId === roundId);
    if (!round) throw new ApiError(404, `Round ${roundId} not found`);

    // Only update if no draftId yet (don't overwrite)
    if (!round.draftId) {
      round.draftId = draftId;
    }

    tx.set(queueRef, queue);
  });
}

/**
 * Update a queue round's status (e.g., to 'drafting' when draft starts).
 * Also optionally updates member count for display purposes.
 */
export async function updateQueueRoundStatus(
  type: 'jackpot' | 'hof',
  roundId: number,
  status: 'filling' | 'ready' | 'drafting' | 'completed',
): Promise<void> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) return;
    const queue = snap.data() as DraftQueue;
    if (!queue.rounds) return;

    const round = queue.rounds.find(r => r.roundId === roundId);
    if (!round) return;

    round.status = status;
    tx.set(queueRef, queue);
  });
}

/**
 * Fill a queue round with bot members and set status to 'drafting'.
 * Used in staging when bots are added to the Go API but not to Firestore.
 */
export async function fillQueueRoundWithBots(
  type: 'jackpot' | 'hof',
  roundId: number,
  botCount: number,
): Promise<void> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) return;
    const queue = snap.data() as DraftQueue;
    if (!queue.rounds) return;

    const round = queue.rounds.find(r => r.roundId === roundId);
    if (!round) return;

    // Add bot members to match Go API
    for (let i = 0; i < botCount; i++) {
      const botWallet = `bot-${type}-${Date.now()}-${i}`;
      if (!round.members.some(m => m.wallet === botWallet)) {
        round.members.push({ wallet: botWallet, joinedAt: Date.now() });
      }
    }

    round.status = 'drafting';
    tx.set(queueRef, queue);
  });
}

export async function resetQueue(type: 'jackpot' | 'hof'): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(QUEUES_COLLECTION).doc(type).set(emptyQueueDoc(type));
}

// ==================== DAILY-DRAFTS PROMO: DRAFT COMPLETION TRACKING ====================

const DAILY_DRAFTS_PROMO_ID = '1';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function recordDraftCompletion(userId: string, draftId: string): Promise<Promo | null> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(DAILY_DRAFTS_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return null;

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'daily-drafts') return null;

    const ids = promo.completedDraftIds || [];

    if (ids.includes(draftId)) return promo;

    let needsTimerDelete = false;
    if (promo.timerEndTime) {
      const expired = new Date(promo.timerEndTime).getTime() < Date.now();
      if (expired && !promo.claimable) {
        promo.progressCurrent = 0;
        promo.timerEndTime = undefined;
        promo.completedDraftIds = [];
        needsTimerDelete = true;
      }
    }

    const prevProgress = promo.progressCurrent || 0;
    promo.progressCurrent = prevProgress + 1;
    promo.completedDraftIds = [...(promo.completedDraftIds || []), draftId];

    if (prevProgress === 0) {
      promo.timerEndTime = new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString();
    }

    // Target reached: 3/4 → (4th draft) → 0/4 with CLAIM button + 24:00:00.
    if (promo.progressCurrent >= (promo.progressMax || 4)) {
      promo.progressCurrent = 0;
      promo.claimable = true;
      promo.claimCount = (promo.claimCount || 0) + 1;
      promo.timerEndTime = undefined;
      promo.completedDraftIds = [];
      needsTimerDelete = true;
    }

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    if (needsTimerDelete) {
      tx.update(promoRef, { timerEndTime: FieldValue.delete() });
    }
    return deepClone(promo);
  });
}

// ==================== PICK-10 PROMO: RECORD WHEN USER GETS PICK #10 ====================

const PICK10_PROMO_ID = '2';

export async function recordPick10(userId: string, draftId: string, _draftName: string): Promise<Promo | null> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(PICK10_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return null;

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'pick-10') return null;

    const history = promo.modalContent.pick10History || [];

    if (history.some(h => h.draftName === draftId)) return promo;

    history.unshift({
      date: new Date().toISOString().split('T')[0],
      draftName: draftId,
      status: 'claim' as const,
    });
    promo.modalContent.pick10History = history;
    promo.modalContent.totalPick10s = (promo.modalContent.totalPick10s || 0) + 1;

    const claimableCount = history.filter(h => h.status === 'claim').length;
    promo.progressCurrent = 1;
    promo.claimable = true;
    promo.claimCount = claimableCount;

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    return deepClone(promo);
  });
}

// ==================== JACKPOT-HIT PROMO: RECORD WHEN USER LANDS IN A JACKPOT DRAFT ====================

const JACKPOT_HIT_PROMO_ID = '4';
const BATCH_SIZE = 100;

/**
 * Bonus tiers for the jackpot promo:
 *   • slot 1–25  → 10 spins (early-batch hit)
 *   • slot 26–50 → 5 spins
 *   • slot 51–100 → 1 spin (standard)
 * `position` is 1-indexed within the current batch (1..100).
 */
function jackpotSpinReward(position: number): number {
  if (position >= 1 && position <= 25) return 10;
  if (position >= 26 && position <= 50) return 5;
  return 1;
}

/**
 * Deterministically pick the JP winner index (0..9) from the draftId.
 * Same draftId always resolves to the same index, so every drafter who
 * calls recordJackpotHit can independently agree on who won. Eventually
 * this should derive from the same VRF seed used for slot derivation;
 * for now sha256(draftId) is fine on staging.
 */
function jackpotWinnerIndex(draftId: string): number {
  const hash = crypto.createHash('sha256').update(draftId).digest();
  // Use the first 4 bytes as a uint32 to keep modulo bias negligible.
  const n = hash.readUInt32BE(0);
  return n % 10;
}

/**
 * Look up the draft order from the Go API and return the ownerId at the
 * given index. Used to gate recordJackpotHit so only the deterministically
 * picked winner gets credited.
 */
async function getDraftWinnerOwner(draftId: string, winnerIndex: number): Promise<string | null> {
  try {
    const baseUrl = (
      process.env.STAGING_DRAFTS_API_URL ||
      process.env.NEXT_PUBLIC_DRAFTS_API_URL ||
      'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
    ).replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/draft/${encodeURIComponent(draftId)}/state/info`);
    if (!res.ok) return null;
    const data = (await res.json()) as { draftOrder?: { ownerId?: string }[] };
    const order = Array.isArray(data?.draftOrder) ? data.draftOrder : [];
    const winner = order[winnerIndex];
    return typeof winner?.ownerId === 'string' ? winner.ownerId.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the position-in-batch for the JP draft. Prefer reading the
 * draftTracker.FilledLeaguesCount counter (same source as
 * /api/batches/current); fall back to the last entry's position+1 if the
 * counter is unreadable. Slight drift if multiple drafts fill in parallel
 * is acceptable on staging.
 */
async function getCurrentBatchPosition(): Promise<number> {
  try {
    const db = getAdminFirestore();
    const snap = await db.collection('drafts').doc('draftTracker').get();
    if (!snap.exists) return 1;
    const filled = Number(((snap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount) ?? 0);
    // The JP draft just filled, so its 1-indexed position within this batch
    // is ((filled - 1) % BATCH_SIZE) + 1, with a guard for filled === 0.
    if (filled <= 0) return 1;
    return ((filled - 1) % BATCH_SIZE) + 1;
  } catch {
    return 1;
  }
}

export async function recordJackpotHit(userId: string, draftId: string): Promise<Promo | null> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  // Only 1 of the 10 drafters wins, per the promo rules. Pick the winner
  // deterministically from sha256(draftId). Every drafter calls this
  // endpoint when their slot machine reveals JACKPOT, but the gate below
  // makes sure only the picked winner's promo gets credited.
  const winnerIndex = jackpotWinnerIndex(draftId);
  const winnerOwnerId = await getDraftWinnerOwner(draftId, winnerIndex);
  if (winnerOwnerId === null) {
    // Couldn't fetch draft order — bail rather than risk crediting wrong wallet.
    return null;
  }
  if (winnerOwnerId !== userId.toLowerCase()) {
    // Caller is in the JP draft but isn't the picked winner. No credit.
    return null;
  }

  const position = await getCurrentBatchPosition();
  const reward = jackpotSpinReward(position);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(JACKPOT_HIT_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return null;

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'jackpot') return null;

    const history = promo.modalContent.jackpotHistory || [];

    if (history.some(h => h.draftName === draftId)) return promo;

    history.unshift({
      date: new Date().toISOString().split('T')[0],
      draftName: draftId,
      amount: reward,
    });
    promo.modalContent.jackpotHistory = history;
    promo.progressCurrent = 1;
    promo.claimable = true;
    promo.claimCount = (promo.claimCount || 0) + reward;

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    return deepClone(promo);
  });
}

// ── Persona Verification ──────────────────────────────────────────────

export interface PersonaVerificationData {
  tier1: { verified: boolean; inquiryId?: string; verifiedAt?: string; geoState?: string };
  tier2: { verified: boolean; inquiryId?: string; verifiedAt?: string };
  cumulativeWithdrawals: number;
}

const DEFAULT_PERSONA: PersonaVerificationData = {
  tier1: { verified: false },
  tier2: { verified: false },
  cumulativeWithdrawals: 0,
};

export async function getPersonaVerification(userId: string): Promise<PersonaVerificationData> {
  const db = getAdminFirestore();
  const doc = await db.collection(PERSONA_COLLECTION).doc(userId).get();
  if (!doc.exists) return { ...DEFAULT_PERSONA };
  return doc.data() as PersonaVerificationData;
}

export async function savePersonaVerification(userId: string, data: Partial<PersonaVerificationData>): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(PERSONA_COLLECTION).doc(userId).set(data, { merge: true });
}

export async function incrementCumulativeWithdrawals(userId: string, amount: number): Promise<number> {
  const db = getAdminFirestore();
  const ref = db.collection(PERSONA_COLLECTION).doc(userId);
  const doc = await ref.get();
  const current = doc.exists ? (doc.data() as PersonaVerificationData).cumulativeWithdrawals || 0 : 0;
  const newTotal = current + amount;
  await ref.set({ cumulativeWithdrawals: newTotal }, { merge: true });
  return newTotal;
}
