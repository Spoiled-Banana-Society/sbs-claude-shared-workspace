import crypto from 'node:crypto';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { API_CONFIG, getUsdcPaymentAddressOrThrow } from '@/lib/api/config';
import { ApiError } from '@/lib/api/errors';
import { seedDb } from '@/lib/api/seed';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { verifyPurchaseTx } from '@/lib/onchain/verifyPurchaseTx';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
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
  Ripeness,
  User,
  UserBadge,
  UserExposure,
  WheelPrize,
  WheelSpin,
} from '@/types';
import { BADGE_BY_ID, BADGE_CATALOG, seedUserBadges } from '@/lib/badges/catalog';
import { ripenessFromCount, unlockedRipenessIds } from '@/lib/badges/ripeness';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { pushStreamEvent } from '@/lib/userEventStream';
import { createNotification } from '@/lib/queueNotifications';
import { applyCompletionGate, computeFirstPurchaseGrant, computeMintProgress } from '@/lib/promoMath';

const USERS_COLLECTION = 'v2_users';
const PURCHASES_COLLECTION = 'v2_purchases';
const WITHDRAWALS_COLLECTION = 'withdrawalRequests';
const PERSONA_COLLECTION = 'personaVerifications';
const CONTESTS_COLLECTION = 'v2_contests';

const REFERRAL_CODES_COLLECTION = 'v2_referral_codes';
const PROMOS_SUBCOLLECTION = 'promos';
const WHEEL_SPINS_SUBCOLLECTION = 'wheelSpins';
const BADGES_SUBCOLLECTION = 'badges';
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
  badges: UserBadge[];
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
    cardFeeCreditCents: 0,
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
  const badges = deepClone(seedDb.badgesByUser['1'] ?? seedUserBadges());
  const exposure: UserExposure = {
    ...deepClone(seedDb.exposureByUser['1'] ?? { username: user.username, totalDrafts: 0, exposures: [] }),
    username: user.username,
  };
  const draftHistory = deepClone(seedDb.draftHistoryByUser['1'] ?? []);
  const referral = { code, createdAt: todayDate() };

  return { user, promos, wheelSpins, badges, exposure, draftHistory, referral };
}

async function ensureUserSeeded(userId: string): Promise<User> {
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const snap = await userRef.get();
  if (snap.exists) return snap.data() as User;

  const seed = buildSeedUser(userId);
  const batch = db.batch();

  // Denormalized lowercase username powers case-insensitive friend search.
  // Keep this in sync at every write site that touches `username`.
  const seedUserWithLower = {
    ...seed.user,
    username_lower: seed.user.username ? seed.user.username.toLowerCase() : undefined,
  };
  batch.set(userRef, stripUndefined(seedUserWithLower));

  for (const promo of seed.promos) {
    const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(promo.id);
    batch.set(promoRef, stripUndefined(promo));
  }

  for (const spin of seed.wheelSpins) {
    const spinRef = userRef.collection(WHEEL_SPINS_SUBCOLLECTION).doc(spin.id);
    batch.set(spinRef, stripUndefined(spin));
  }

  for (const badge of seed.badges) {
    const badgeRef = userRef.collection(BADGES_SUBCOLLECTION).doc(badge.id);
    batch.set(badgeRef, stripUndefined(badge));
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

  // Overlay the latest static copy from the canonical seed (title,
  // description, CTA, explanation) onto each promo. Per-user state
  // (claimCount, claimable, progressCurrent, history arrays, referral
  // codes, etc.) is preserved. This means copy edits in seed.ts
  // propagate to existing users on their next read — no migration
  // needed.
  const seedById = new Map(seedList.map(p => [p.id, p]));

  return allDocs.map((promo) => {
    const seed = seedById.get(promo.id);
    if (seed) {
      promo.title = seed.title;
      promo.description = seed.description;
      promo.ctaText = seed.ctaText;
      promo.ctaLink = seed.ctaLink;
      promo.backgroundColor = seed.backgroundColor;
      promo.progressMax = seed.progressMax;
      // modalContent.title and modalContent.explanation are static copy;
      // other modalContent fields (history arrays, referral codes,
      // twitterConnected) are per-user state.
      if (seed.modalContent) {
        promo.modalContent = promo.modalContent || {};
        if (seed.modalContent.title !== undefined) {
          promo.modalContent.title = seed.modalContent.title;
        }
        if (seed.modalContent.explanation !== undefined) {
          promo.modalContent.explanation = seed.modalContent.explanation;
        }
        if (seed.modalContent.additionalRules !== undefined) {
          promo.modalContent.additionalRules = seed.modalContent.additionalRules;
        }
      }
    }
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
        // Register into the Go API immediately, typed `free`, so the bonus
        // pass is usable for draft entry without waiting on the Alchemy webhook.
        await registerMintedTokens(userId, mintRes.tokenIds, 'free').catch((e) =>
          logger.warn('promo.claim.register_go_api_failed', { userId, promoId, err: (e as Error).message }),
        );
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

    // Server-side "Promo Claimed!" notification — fired the instant the claim
    // commits so it reaches every device in real-time (content-carrying ping),
    // instead of the client firing a second round-trip after the claim returns.
    if (result.spinsAdded > 0) {
      const isBuyBonus = result.promo.type === 'buy-bonus';
      void createNotification(userId, {
        type: 'promo',
        title: 'Promo Claimed!',
        message: `You earned ${result.spinsAdded} ${isBuyBonus ? 'free draft' : 'wheel spin'}${result.spinsAdded !== 1 ? 's' : ''}!`,
        link: isBuyBonus ? '/drafting' : '/banana-wheel',
        icon: isBuyBonus ? 'ticket' : 'spin',
      });
    }

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
  }).then((result) => {
    // Real-time push to the referrer ONLY when the milestone actually
    // flipped (result.updated). Friend identity is NOT in the payload —
    // the frontend refetches /api/promos (Privy-authed) to render the
    // full toast string ("Your friend Sarah verified!").
    if (result.updated && result.referrerUserId) {
      void pushStreamEvent(result.referrerUserId, 'referral-milestone', { milestone });
    }
    return result;
  });
}

export async function spinWheel(userId: string): Promise<{ spin: WheelSpin; user: User }> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const userRef = db.collection(USERS_COLLECTION).doc(userId);

  const result = await db.runTransaction(async (tx) => {
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

  // Club badges on a jackpot/HOF wheel win — fire-and-forget so a Firestore
  // hiccup on the badge write doesn't roll back the spin reward. Idempotent,
  // so retries (and the badge sweep) are safe. Winning JP/HOF on the wheel is
  // an alternate path into the same club as entering that draft type.
  if (result.spin.prize.type === 'jackpot') {
    void unlockBadge(userId, 'jackpot-club', { source: 'wheel', spinId: result.spin.id }).catch(() => {});
  } else if (result.spin.prize.type === 'hof') {
    void unlockBadge(userId, 'hof-club', { source: 'wheel', spinId: result.spin.id }).catch(() => {});
  }

  return result;
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
  opts: { handleFirstPurchase?: boolean } = {},
): Promise<{ mintMilestonesEarned: number; buyBonusMilestonesEarned: number; firstPurchaseSpinsEarned: number }> {
  // READS FIRST — Firestore requires every read before any write in a tx.
  const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));
  // Only the wrapper-driven paid paths (card-mint / staging-mint) handle the
  // first-purchase bonus; the legacy verifyPurchase path writes userRef itself
  // and opts out to avoid a double-write to the user doc.
  const userSnap = opts.handleFirstPurchase ? await tx.get(userRef) : null;

  let mintMilestonesEarned = 0;
  const mintPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'mint');
  if (mintPromoDoc) {
    const mintPromo = deepClone(mintPromoDoc.data() as Promo);
    mintPromo.modalContent.totalMinted = (mintPromo.modalContent.totalMinted || 0) + quantity;
    const max = mintPromo.progressMax || 10;
    const { progressCurrent, milestonesEarned } = computeMintProgress(mintPromo.progressCurrent || 0, max, quantity);
    mintPromo.progressCurrent = progressCurrent;
    if (milestonesEarned > 0) {
      mintPromo.claimCount = (mintPromo.claimCount || 0) + milestonesEarned;
      recalcPromoClaimable(mintPromo);
      mintMilestonesEarned = milestonesEarned;
    }
    tx.set(mintPromoDoc.ref, stripUndefined(mintPromo), { merge: true });
  }

  // First-purchase bonus: every 4 passes on the user's FIRST paid purchase = 1
  // spin. One-time — the durable `firstPurchaseBonusGranted` flag gates it (so
  // retries can't double-grant). Runs in the SAME tx as the mint promo above,
  // so a single purchase advances both atomically (interconnection).
  let firstPurchaseSpinsEarned = 0;
  if (opts.handleFirstPurchase && userSnap) {
    const userData = userSnap.data() as User | undefined;
    const grant = computeFirstPurchaseGrant(!!userData?.firstPurchaseBonusGranted, quantity);
    if (grant.consume) {
      tx.set(userRef, { firstPurchaseBonusGranted: true }, { merge: true });
      if (grant.spins > 0) {
        const fpDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'first-purchase');
        if (fpDoc) {
          const fpPromo = deepClone(fpDoc.data() as Promo);
          fpPromo.claimCount = (fpPromo.claimCount || 0) + grant.spins;
          recalcPromoClaimable(fpPromo);
          tx.set(fpDoc.ref, stripUndefined(fpPromo), { merge: true });
          firstPurchaseSpinsEarned = grant.spins;
        }
      }
    }
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

  return { mintMilestonesEarned, buyBonusMilestonesEarned, firstPurchaseSpinsEarned };
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
): Promise<{ mintMilestonesEarned: number; buyBonusMilestonesEarned: number; firstPurchaseSpinsEarned: number }> {
  if (quantity <= 0) return { mintMilestonesEarned: 0, buyBonusMilestonesEarned: 0, firstPurchaseSpinsEarned: 0 };
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const result = await db.runTransaction((tx) => _incrementMintPromosInTx(tx, userRef, quantity, { handleFirstPurchase: true }));
  // Post-commit push: first-purchase bonus spins earned (one-time). Lets the
  // client toast "earned N free spins — claim now" and refresh the promo.
  if (result.firstPurchaseSpinsEarned > 0) {
    void pushStreamEvent(userId, 'promo-first-purchase', {
      awardedCount: result.firstPurchaseSpinsEarned,
    });
  }
  // Post-commit push. Fires once per actual milestone earned (Buy 10
  // can fire multiple times in a single bulk mint — e.g. quantity=20
  // earns 2 spins). awardedCount lets the toast read "earned 2 free spins".
  if (result.mintMilestonesEarned > 0) {
    void pushStreamEvent(userId, 'promo-buy-10', {
      awardedCount: result.mintMilestonesEarned,
    });
  }
  // Always nudge the user's devices to refetch promos so the mint progress
  // box (e.g. 9/10) syncs in real-time across devices on EVERY purchase, not
  // just when a milestone is hit. (usePromos refetches on any stream ping.)
  void pushStreamEvent(userId, 'notification', { source: 'purchase' });
  return result;
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

  // Stashed inside the transaction; pushed to the user event stream
  // only AFTER the transaction commits (firing inside would notify on
  // a tx that might still roll back). Captured by closure on userId.
  let _mintMilestonesForPostCommitPush = 0;

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

  const txResult = await db.runTransaction(async (tx) => {
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

    const { mintMilestonesEarned, buyBonusMilestonesEarned } = await _incrementMintPromosInTx(tx, userRef, purchase.quantity);
    if (buyBonusMilestonesEarned > 0) {
      freeDraftsAdded = buyBonusMilestonesEarned * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
    }
    // Stash for post-commit event push (inside this transaction the data
    // isn't durable yet — firing here would notify on a tx that might
    // still roll back).
    _mintMilestonesForPostCommitPush = mintMilestonesEarned;

    await _incrementReferralPromosInTx(tx, user, purchase.userId, purchase.quantity);

    // NOTE: the legacy "every 6 card purchases = 1 free draft" payout was
    // removed here. The card-fee → free-draft reward now lives solely in the
    // card-mint route, keyed off accumulated card fees (cardFeeCreditCents),
    // and grants a paid-type draft. See app/api/purchases/card-mint/route.ts.

    tx.set(purchaseRef, stripUndefined(purchase), { merge: true });
    tx.set(userRef, stripUndefined(user), { merge: true });

    return {
      purchase: deepClone(purchase),
      user: deepClone(user),
      spinsAdded,
      draftPassesAdded,
      freeDraftsAdded,
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

  // Post-commit push (Buy 10). The other public wrappers fire their
  // own event; this verifyPurchase path calls _incrementMintPromosInTx
  // directly inside a larger transaction, so we delay the event until
  // after the outer transaction commits successfully.
  if (_mintMilestonesForPostCommitPush > 0) {
    void pushStreamEvent(prePurchase.userId, 'promo-buy-10', {
      awardedCount: _mintMilestonesForPostCommitPush,
    });
  }
  // Always nudge devices to refetch promos so mint progress (e.g. 9/10) syncs
  // in real-time on every purchase, not just at a milestone.
  void pushStreamEvent(prePurchase.userId, 'notification', { source: 'purchase' });

  return txResult;
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

/**
 * Recompute the user's exposure dashboard from the Go API's roster data.
 * Idempotent — safe to call after every draft completion. Pulls
 * `/owner/{wallet}/draftToken/all`, aggregates team+slot picks across
 * every active token, and writes the result to
 * `users/{userId}/metadata/exposure`.
 *
 * Slot convention (matches the seed):
 *  - QB / TE / DST → just the position (e.g. "KC QB")
 *  - RB / WR → real team slot parsed from playerId (e.g. "SF RB1" vs
 *    "SF RB2" — these are different slots in the game, not pick-order
 *    labels). Determined by the suffix after "TEAM-" in playerId.
 *
 * Existing display fields (adp, projectedPoints, bye, displayName) are
 * preserved on a per-teamPosition basis so we don't blank them out on
 * recompute. New combos that didn't exist before show empty for those
 * fields — that's fine, the Exposure UI handles missing values.
 */
export interface ExposureRecomputeDiag {
  url?: string;
  status?: number;
  tokenCount?: number;
  tokensWithRoster?: number;
  sampleKeys?: string[];
  totalDraftsAfterAgg?: number;
  distinctSlots?: number;
  error?: string;
  reason?: string;
}

// Derive the "TEAM SLOT" exposure key (e.g. "SF RB2", "KC QB") from a pick.
// Used by BOTH the draft-count aggregation and the actual-pick aggregation so
// their keys line up exactly. RB/WR slots live in the playerId as "TEAM-SLOT".
function exposureSlotKey(
  team: string,
  positionGroup: string,
  playerId?: string,
  position?: string,
): string {
  const slotFromId = (() => {
    if (!playerId) return null;
    const dash = playerId.indexOf('-');
    if (dash < 0) return null;
    const suffix = playerId.slice(dash + 1).toUpperCase();
    return suffix.startsWith(positionGroup) ? suffix : null;
  })();
  const slot = slotFromId
    ?? (position && position.toUpperCase().startsWith(positionGroup) ? position.toUpperCase() : null)
    ?? positionGroup;
  return `${team} ${slot}`;
}

export async function recomputeUserExposure(
  userId: string,
  diagOut?: ExposureRecomputeDiag,
): Promise<UserExposure | null> {
  const lower = userId.toLowerCase();
  // Staging-only — never fall through to NEXT_PUBLIC_DRAFTS_API_URL,
  // which on Vercel is set to the production URL and would leak prod
  // roster data into staging exposure docs. Same pattern the badge
  // sweep uses (app/api/badges/route.ts).
  const baseUrl = (
    process.env.STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
  ).replace(/\/$/, '');

  let active: Array<{ _leagueId?: string; roster?: Record<string, Array<{ team?: string; position?: string; playerId?: string; displayName?: string }> | undefined> }> = [];
  try {
    const url = `${baseUrl}/owner/${encodeURIComponent(lower)}/draftToken/all`;
    if (diagOut) diagOut.url = url;
    const res = await fetch(url, { cache: 'no-store' });
    if (diagOut) diagOut.status = res.status;
    if (!res.ok) {
      if (diagOut) diagOut.reason = 'go-api-not-ok';
      return null;
    }
    const body = (await res.json()) as { active?: typeof active };
    active = body.active ?? [];
    if (diagOut) {
      diagOut.tokenCount = active.length;
      diagOut.tokensWithRoster = active.filter(t => t.roster && Object.values(t.roster).some(p => Array.isArray(p) && p.length > 0)).length;
      diagOut.sampleKeys = active[0]?.roster ? Object.keys(active[0].roster) : [];
    }
  } catch (err) {
    if (diagOut) {
      diagOut.error = String(err);
      diagOut.reason = 'fetch-threw';
    }
    logger.warn('exposure.recompute.fetch.failed', { userId: lower, err: String(err) });
    return null;
  }

  const counts = new Map<string, { team: string; position: string; drafts: number; displayName?: string }>();
  let totalDrafts = 0;

  const recordSlot = (positionGroup: 'QB' | 'RB' | 'WR' | 'TE' | 'DST', players: Array<{ team?: string; playerId?: string; position?: string; displayName?: string }> | undefined): boolean => {
    if (!players?.length) return false;
    let any = false;
    players.forEach((p) => {
      if (!p?.team) return;
      // SF RB1 and SF RB2 are DIFFERENT team-position slots — the slot is a
      // property of the pick, not the user's draft order. The Go API
      // encodes it in playerId as "TEAM-SLOT" (e.g. "MIA-RB1", "SF-RB2",
      // "KC-QB"). Parse the slot from there. Fall back to `position` if
      // playerId is missing for any reason, then to just the position
      // group (so the row still aggregates somewhere on legacy data).
      const teamPosition = exposureSlotKey(p.team, positionGroup, p.playerId, p.position);
      // slot is the key minus the "TEAM " prefix (team has no spaces).
      const slot = teamPosition.slice(p.team.length + 1);
      const prev = counts.get(teamPosition);
      counts.set(teamPosition, {
        team: p.team,
        position: slot,
        drafts: (prev?.drafts ?? 0) + 1,
        displayName: prev?.displayName ?? p.displayName,
      });
      any = true;
    });
    return any;
  };

  for (const token of active) {
    const roster = token.roster || {};
    let hasPicks = false;
    if (recordSlot('QB', roster.QB)) hasPicks = true;
    if (recordSlot('RB', roster.RB)) hasPicks = true;
    if (recordSlot('WR', roster.WR)) hasPicks = true;
    if (recordSlot('TE', roster.TE)) hasPicks = true;
    if (recordSlot('DST', roster.DST)) hasPicks = true;
    if (hasPicks) totalDrafts += 1;
  }

  if (diagOut) {
    diagOut.totalDraftsAfterAgg = totalDrafts;
    diagOut.distinctSlots = counts.size;
  }
  if (totalDrafts === 0) {
    if (diagOut) diagOut.reason = 'no-rosters-with-team';
    return null;
  }

  // ── Actual pick numbers ("where did I actually draft this") ─────────────
  // draftToken/all doesn't carry the pick number, so pull each draft's
  // per-player state — the same `/draft/{id}/playerState/{wallet}` endpoint
  // the draft-room roster uses (playerStateInfo.pickNum) — and average the
  // overall pick per team-position. Best-effort: any draft whose state can't
  // be fetched is skipped, so avgPick simply stays unset for those rows.
  const POS_GROUPS = ['QB', 'RB', 'WR', 'TE', 'DST'];
  // Per team-position: running totals for actual pick number AND real ADP.
  // ADP comes from each player's stats.adp — the SAME real value the draft
  // room shows (the /league/rankings/global endpoint 404s on staging, so we
  // must NOT use it; this per-draft stats.adp is the legit working source).
  const pickAgg = new Map<string, { pickSum: number; pickN: number; adpSum: number; adpN: number }>();
  const leagueIds = Array.from(
    new Set(active.map(t => t._leagueId).filter((id): id is string => !!id)),
  );
  await Promise.all(leagueIds.map(async (leagueId) => {
    try {
      const url = `${baseUrl}/draft/${encodeURIComponent(leagueId)}/playerState/${encodeURIComponent(lower)}`;
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const players = (await res.json()) as Array<{
        playerStateInfo?: { team?: string; position?: string; playerId?: string; ownerAddress?: string; pickNum?: number };
        stats?: { adp?: number };
      }>;
      if (!Array.isArray(players)) return;
      for (const pl of players) {
        const info = pl?.playerStateInfo;
        if (!info?.team) continue;
        // Only the user's own picks (others' ownerAddress / unowned "" are skipped).
        if ((info.ownerAddress || '').toLowerCase() !== lower) continue;
        const pickNum = Number(info.pickNum);
        if (!Number.isFinite(pickNum) || pickNum <= 0) continue;
        const group = (info.position || '').toUpperCase().replace(/[0-9]/g, '');
        const positionGroup = POS_GROUPS.includes(group)
          ? group
          : POS_GROUPS.find(g => (info.playerId || '').toUpperCase().includes(`-${g}`));
        if (!positionGroup) continue;
        const key = exposureSlotKey(info.team, positionGroup, info.playerId, info.position);
        const prev = pickAgg.get(key) || { pickSum: 0, pickN: 0, adpSum: 0, adpN: 0 };
        prev.pickSum += pickNum;
        prev.pickN += 1;
        const adp = Number(pl?.stats?.adp);
        if (Number.isFinite(adp) && adp > 0) {
          prev.adpSum += adp;
          prev.adpN += 1;
        }
        pickAgg.set(key, prev);
      }
    } catch {
      // best-effort; skip this draft's pick data
    }
  }));

  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(lower);
  const exposureRef = userRef.collection('metadata').doc(EXPOSURE_DOC);
  const [existingSnap, userSnap] = await Promise.all([exposureRef.get(), userRef.get()]);
  const existing = existingSnap.exists ? (existingSnap.data() as UserExposure) : null;
  const existingMap = new Map<string, UserExposure['exposures'][number]>();
  for (const e of existing?.exposures ?? []) existingMap.set(e.teamPosition, e);
  const username = userSnap.exists ? ((userSnap.data() as User).username || '') : (existing?.username || '');

  const exposures: UserExposure['exposures'] = [];
  for (const [teamPosition, { team, position, drafts, displayName }] of counts.entries()) {
    const prev = existingMap.get(teamPosition);
    const pa = pickAgg.get(teamPosition);
    const avgPick = pa && pa.pickN > 0 ? Math.round((pa.pickSum / pa.pickN) * 10) / 10 : prev?.avgPick;
    // Real ADP from the drafts' stats.adp; preserve prior value if this run
    // couldn't fetch any (rather than blanking a previously-good number).
    const adp = pa && pa.adpN > 0 ? Math.round((pa.adpSum / pa.adpN) * 10) / 10 : prev?.adp;
    exposures.push({
      team,
      position,
      teamPosition,
      drafts,
      totalDrafts,
      exposure: Math.round((drafts / totalDrafts) * 100),
      displayName: displayName ?? prev?.displayName,
      bye: prev?.bye,
      adp,
      projectedPoints: prev?.projectedPoints,
      avgPick,
    });
  }
  exposures.sort((a, b) => b.drafts - a.drafts);

  const newExposure: UserExposure = { username, totalDrafts, exposures };
  await exposureRef.set(stripUndefined(newExposure));
  return newExposure;
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
const FIRST_PURCHASE_PROMO_ID = '11';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * New-user first-purchase popup gate. A wheel-won draft just completed — count
 * it down. Runs for EVERY completion regardless of pass type: pre-purchase, a
 * user's only drafts are their wheel winnings (free drafts, plus jackpot/HOF
 * entries), so all of them must finish before the popup appears. When the LAST
 * one finishes the first-purchase promo unlocks (popup + notification).
 * Idempotent per draftId (deduped on the first-purchase promo's
 * completedDraftIds) and a no-op once the user has purchased, already unlocked,
 * or never had winnings to finish — so it never fires for existing buyers.
 */
async function _recordWinningsDraftForFirstPurchaseGate(userId: string, draftId: string): Promise<void> {
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(FIRST_PURCHASE_PROMO_ID);

  const unlocked = await db.runTransaction(async (tx) => {
    const [userSnap, promoSnap] = await Promise.all([tx.get(userRef), tx.get(promoRef)]);
    if (!userSnap.exists) return false;
    const user = userSnap.data() as User;
    // Past the gate already, or no winnings outstanding — nothing to do.
    if (user.firstPurchaseBonusGranted || user.firstPurchasePromoUnlocked) return false;
    if ((user.pendingWheelWinnings || 0) <= 0) return false;

    // Idempotency: dedup completions on the first-purchase promo doc.
    const promo = promoSnap.exists ? deepClone(promoSnap.data() as Promo) : null;
    const seen = promo?.completedDraftIds || [];
    if (seen.includes(draftId)) return false;

    const gate = applyCompletionGate({
      usedFreePass: true,
      pendingWheelWinnings: user.pendingWheelWinnings || 0,
      firstPurchaseBonusGranted: !!user.firstPurchaseBonusGranted,
      firstPurchasePromoUnlocked: !!user.firstPurchasePromoUnlocked,
    });

    const userUpdate: Record<string, unknown> = { pendingWheelWinnings: gate.pendingWheelWinnings };
    if (gate.unlock) userUpdate.firstPurchasePromoUnlocked = true;
    tx.set(userRef, userUpdate, { merge: true });

    if (promo) {
      promo.completedDraftIds = [...seen, draftId];
      tx.set(promoRef, stripUndefined(promo), { merge: true });
    }
    return gate.unlock;
  });

  if (unlocked) {
    void pushStreamEvent(userId, 'first-purchase-unlocked', {});
  }
}

/**
 * Public entry for the new-user first-purchase gate, called when a wheel-won
 * draft is FINISHED — i.e. the user has reached their post-draft roster page
 * (/draft-results), so the draft is actually done and they're OUTSIDE the draft
 * room. This is the fix for the gate firing too early: it used to run when a
 * draft merely FILLED (via recordDraftCompletion). It decrements the
 * remaining-winnings counter; when that counter hits 0 (their LAST free draft
 * just finished) the promo unlocks and the popup/notification/banner fire.
 * Idempotent per draftId and a no-op once purchased / already pinged, so
 * re-visiting the roster page can't double-fire.
 */
export async function recordFirstPurchaseDraftFinished(userId: string, draftId: string): Promise<void> {
  await _recordWinningsDraftForFirstPurchaseGate(userId, draftId);
}

/**
 * Looks up the token the user holds for `draftId` from the Go API (the source
 * of truth — every draft token is stamped with the pass type chosen at entry,
 * and a token only exists for a draft the user actually entered). Distinguishes
 * four cases so promo crediting can both block free drafts AND require real
 * participation:
 *
 *   { passType: 'free',  confirmed: true }   token found, free stamp
 *   { passType: 'paid',  confirmed: true }   token found, paid/blank stamp (real participant)
 *   { passType: null,    confirmed: true }   API OK, NO token for this draft → not a participant
 *   { passType: null,    confirmed: false }  API error/timeout → couldn't determine
 *
 * `confirmed` is the key distinction: a CONFIRMED "no token" means the wallet
 * provably never entered this draft (a forged / unowned draftId), whereas an
 * unconfirmed null is just a transient lookup failure we must not punish.
 */
type DraftEntry = { passType: 'free' | 'paid' | null; confirmed: boolean };

async function resolveDraftEntry(userId: string, draftId: string): Promise<DraftEntry> {
  if (!draftId) return { passType: null, confirmed: false };
  const lower = userId.toLowerCase();
  const baseUrl = (
    process.env.STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
  ).replace(/\/$/, '');

  // One Go-API read (the SAME call this gate has always made — no added latency
  // on the normal path). Returns confirmed:true only when the API actually
  // answered; a thrown error means we couldn't reach it.
  const attempt = async (): Promise<DraftEntry> => {
    const res = await fetch(`${baseUrl}/owner/${encodeURIComponent(lower)}/draftToken/all`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`draftToken/all HTTP ${res.status}`);
    const body = (await res.json()) as {
      active?: Array<Record<string, unknown>>;
      available?: Array<Record<string, unknown>>;
    };
    const all = [...(body.active ?? []), ...(body.available ?? [])];
    const tok = all.find((t) => String(t._leagueId ?? t.leagueId ?? '') === draftId);
    if (!tok) return { passType: null, confirmed: true }; // API OK, holds no token for this draft
    const pt = String(tok.passType ?? '');
    if (pt === 'free') return { passType: 'free', confirmed: true };
    return { passType: 'paid', confirmed: true }; // paid or blank stamp → real participant
  };

  try {
    return await attempt();
  } catch {
    // Self-heal a one-off blip with a single retry before we conclude "can't
    // confirm". Only runs on failure, so the normal (success) path is untouched.
    try {
      return await attempt();
    } catch {
      return { passType: null, confirmed: false }; // couldn't reach Go — unconfirmed
    }
  }
}

/**
 * THE shared promo-credit gate for every auto-fired draft promo (daily-drafts,
 * pick-10, jackpot). Credit is granted ONLY when the Go API positively confirms
 * the user holds a PAID token for that exact draft. Anything else earns nothing
 * — we never hand out a promo on a guess:
 *
 *  - paid token         → true  (the only path that earns credit)
 *  - free token         → false (free drafts never earn promos)
 *  - confirmed no token → false (forged/unowned draftId — closes "promo credit
 *                          out of thin air"; logged as an anti-abuse signal)
 *  - couldn't confirm   → false (Go unreachable even after a retry — we do NOT
 *                          credit on uncertainty; logged so it's never invisible)
 *
 * In normal play this never denies a real paid user: the same Go API just ran
 * the draft to fill it, so it's up and the paid token is found. `clientPassType`
 * is recorded for forensics only — it never influences the decision (that's the
 * whole point: don't trust the client). Centralized so all three promos enforce
 * the identical rule and can't drift.
 */
async function promoCreditAllowed(
  userId: string,
  draftId: string,
  promoTag: string,
  clientPassType?: string,
): Promise<boolean> {
  const entry = await resolveDraftEntry(userId, draftId);
  if (entry.passType === 'paid') return true;   // confirmed paid → counts
  if (entry.passType === 'free') return false;  // free draft → never earns (expected, no log)
  // No paid token confirmed → no credit. Log WHY so a wrongly-denied real user
  // (which should never happen in normal play) is immediately visible.
  const source = entry.confirmed
    ? LOG_SOURCES.promo.PARTICIPATION_DENIED      // API said: holds no token for this draft
    : LOG_SOURCES.promo.PARTICIPATION_UNVERIFIED; // couldn't reach Go to confirm
  logger.warn(source, { actor: userId, context: { draftId, promo: promoTag, clientClaimed: clientPassType } });
  return false;
}

export async function recordDraftCompletion(userId: string, draftId: string, passType?: string): Promise<Promo | null> {
  // NOTE: the new-user first-purchase gate USED to run here — but this function
  // fires when a draft FILLS, not when it finishes, which pinged the popup too
  // early (the moment the draft filled). The gate now runs in
  // recordFirstPurchaseDraftFinished, triggered when the user reaches their
  // post-draft roster page (the draft is actually done, outside the draft room).
  // This function stays focused on the daily-drafts credit below.

  // Only PAID drafts count toward daily-drafts. A draft entered with a FREE
  // pass earns zero daily-drafts credit. The token is stamped with the chosen
  // pass type (source of truth) — use it, falling back to the client value only
  // when the stamp can't be read, so a free draft can never sneak past as paid.
  // Credit only a CONFIRMED paid draft. Free drafts, forged/unowned draftIds,
  // and unverifiable calls all earn nothing (see promoCreditAllowed).
  if (!(await promoCreditAllowed(userId, draftId, 'daily-drafts', passType))) {
    return { promo: null as Promo | null, justBecameClaimable: false } as unknown as Promo | null;
  }
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(DAILY_DRAFTS_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return { promo: null as Promo | null, justBecameClaimable: false };

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'daily-drafts') return { promo: null as Promo | null, justBecameClaimable: false };

    const ids = promo.completedDraftIds || [];

    if (ids.includes(draftId)) return { promo: promo as Promo | null, justBecameClaimable: false };

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
    let justBecameClaimable = false;
    if (promo.progressCurrent >= (promo.progressMax || 4)) {
      promo.progressCurrent = 0;
      promo.claimable = true;
      promo.claimCount = (promo.claimCount || 0) + 1;
      promo.timerEndTime = undefined;
      promo.completedDraftIds = [];
      needsTimerDelete = true;
      justBecameClaimable = true;
    }

    // Stamp every progress write so the admin promo-progress endpoint
    // can identify stalled multi-step promo starters (e.g. "did 1 of 4
    // daily drafts, no movement in 48h"). Cheap, non-breaking add.
    (promo as unknown as Record<string, unknown>).updatedAt = new Date().toISOString();

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    if (needsTimerDelete) {
      tx.update(promoRef, { timerEndTime: FieldValue.delete() });
    }
    return { promo: deepClone(promo) as Promo | null, justBecameClaimable };
  }).then(({ promo, justBecameClaimable }) => {
    // Only push on the transition from "in progress" → "claimable".
    // Idempotent per draftId on the transaction side, so this also
    // only fires once per actual 4th-of-the-day completion.
    if (justBecameClaimable) {
      void pushStreamEvent(userId, 'promo-daily-drafts', { draftId });
    }
    return promo;
  });
}

// ==================== PICK-10 PROMO: RECORD WHEN USER GETS PICK #10 ====================

const PICK10_PROMO_ID = '2';

export async function recordPick10(userId: string, draftId: string, _draftName: string, passType?: string): Promise<Promo | null> {
  // Free-pass drafts earn NO promo credit — only paid drafts count toward
  // Pick 10. The draft token is stamped with the chosen pass type (source of
  // truth) — use it, falling back to the client value only when the stamp can't
  // be read, so a free draft can never sneak past as paid (the slot-10 bug).
  // Credit only a CONFIRMED paid draft (see promoCreditAllowed).
  if (!(await promoCreditAllowed(userId, draftId, 'pick-10', passType))) return null;
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(PICK10_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return { promo: null, justAdded: false };

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'pick-10') return { promo: null, justAdded: false };

    const history = promo.modalContent.pick10History || [];

    // Already recorded this draft → no-op, no event push.
    if (history.some(h => h.draftName === draftId)) {
      return { promo, justAdded: false };
    }

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
    // Timestamp every progress write so the admin promo-progress
    // endpoint can identify users who started a multi-step promo but
    // stalled mid-way (e.g. did 1 of 4 daily drafts, didn't come back).
    (promo as unknown as Record<string, unknown>).updatedAt = new Date().toISOString();

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    return { promo: deepClone(promo), justAdded: true };
  }).then(({ promo, justAdded }) => {
    // Only push when the slot-10 entry was newly added (transaction is
    // idempotent on duplicate draftId, so this fires exactly once per
    // actual Pick 10 occurrence).
    if (justAdded) {
      void pushStreamEvent(userId, 'promo-pick-10', { draftId });
    }
    return promo;
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

export async function recordJackpotHit(userId: string, draftId: string, passType?: string): Promise<Promo | null> {
  // Free-pass drafts earn NO promo credit — only paid drafts count toward the
  // jackpot-hit promo. The draft token is stamped with the chosen pass type
  // (source of truth) — use it, falling back to the client value only when the
  // stamp can't be read, so a free draft can never sneak past as paid.
  // Credit only a CONFIRMED paid draft (see promoCreditAllowed). The winner
  // re-derivation below is an additional jackpot-specific gate on top.
  if (!(await promoCreditAllowed(userId, draftId, 'jackpot', passType))) return null;
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
    if (!promoSnap.exists) return { promo: null, justAdded: false, awarded: 0 };

    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'jackpot') return { promo: null, justAdded: false, awarded: 0 };

    const history = promo.modalContent.jackpotHistory || [];

    // Already recorded this draft → no-op, no event push.
    if (history.some(h => h.draftName === draftId)) {
      return { promo, justAdded: false, awarded: 0 };
    }

    history.unshift({
      date: new Date().toISOString().split('T')[0],
      draftName: draftId,
      amount: reward,
    });
    promo.modalContent.jackpotHistory = history;
    promo.progressCurrent = 1;
    promo.claimable = true;
    promo.claimCount = (promo.claimCount || 0) + reward;
    (promo as unknown as Record<string, unknown>).updatedAt = new Date().toISOString();

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    return { promo: deepClone(promo), justAdded: true, awarded: reward };
  }).then(({ promo, justAdded, awarded }) => {
    // Push only when the jackpot was newly credited to this user. The
    // gate above (winnerOwnerId !== userId) ensures only the actual
    // winner reaches this code path.
    if (justAdded) {
      void pushStreamEvent(userId, 'promo-jackpot-hit', { draftId, awardedCount: awarded });
    }
    return promo;
  });
}

// ── Founder Draft promo ──

const FOUNDER_DRAFT_PROMO_ID = 'founder-draft';
const FOUNDER_DRAFT_REWARD = 1; // 1 free draft per qualifying drafter
const FOUNDER_DRAFTS_COLLECTION = 'founderDrafts';

/**
 * Once-and-permanent record that a draft qualified as a Founder Draft at
 * the time it filled. The pill rendering and credit endpoints read this
 * record so changing the founder schedule later doesn't retroactively
 * untag a draft that was already a Founder Draft. Idempotent — first
 * write wins, subsequent calls are no-ops.
 */
export async function markFounderDraft(
  draftId: string,
  meta: { founderWallet: string; scheduleAt: string },
): Promise<void> {
  const db = getAdminFirestore();
  const ref = db.collection(FOUNDER_DRAFTS_COLLECTION).doc(draftId);
  const snap = await ref.get();
  if (snap.exists) return; // already marked, never overwrite
  await ref.set(stripUndefined({
    draftId,
    founderWallet: meta.founderWallet.toLowerCase(),
    scheduleAt: meta.scheduleAt,
    markedAt: new Date().toISOString(),
  }));
}

export async function isFounderDraftMarked(draftId: string): Promise<boolean> {
  const db = getAdminFirestore();
  const snap = await db.collection(FOUNDER_DRAFTS_COLLECTION).doc(draftId).get();
  return snap.exists;
}

/**
 * Credit a user's founder-draft promo when their draft has been verified
 * (server-side) as a Founder Draft. Mirrors recordJackpotHit's shape but
 * has no winner-picker — every drafter in a Founder Draft gets credited,
 * not just one. Validation that the draft IS a founder draft (founder
 * wallet present + within window) lives in the calling endpoint
 * (app/api/promos/founder-draft/route.ts), so this function trusts the
 * caller to have gated correctly.
 *
 * Idempotent via draftId dedupe in modalContent.founderHistory.
 */
export async function recordFounderDraftJoin(userId: string, draftId: string): Promise<Promo | null> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const promoRef = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(PROMOS_SUBCOLLECTION)
    .doc(FOUNDER_DRAFT_PROMO_ID);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);

    // Lazy-seed the founder-draft promo doc if missing. ensureUserSeeded
    // only runs the full seed for never-seen users; pre-existing users
    // who signed up before this promo type was added will have a user doc
    // but no promos/founder-draft doc, and the credit would silently
    // no-op (`if (!exists) return null`). Seed inline from the canonical
    // template in seedDb.promosByUser so the credit can land on the same
    // transaction.
    let promo: Promo;
    if (!promoSnap.exists) {
      const seedList = seedDb.promosByUser['1'] ?? [];
      const template = seedList.find(p => p.id === FOUNDER_DRAFT_PROMO_ID && p.type === 'founder-draft');
      if (!template) return null; // seed list missing the template — fail closed
      promo = deepClone(template);
    } else {
      promo = deepClone(promoSnap.data() as Promo);
      if (promo.type !== 'founder-draft') return null;
    }

    const history = promo.modalContent.founderHistory || [];
    if (history.some(h => h.draftName === draftId)) return promo; // idempotent

    history.unshift({
      date: new Date().toISOString().split('T')[0],
      draftName: draftId,
      amount: FOUNDER_DRAFT_REWARD,
    });
    promo.modalContent.founderHistory = history;
    promo.progressCurrent = 1;
    promo.claimable = true;
    promo.claimCount = (promo.claimCount || 0) + FOUNDER_DRAFT_REWARD;

    tx.set(promoRef, stripUndefined(promo), { merge: true });
    return deepClone(promo);
  });
}

// ── Badges ────────────────────────────────────────────────────────────

/**
 * Read every badge state for a user. Lazy-backfills missing badge docs
 * from the catalog (mirrors the promo lazy-backfill in getPromos) so
 * adding a new badge to BADGE_CATALOG works for existing users without
 * a migration. Returns merged shape: catalog static copy + per-user
 * unlock state.
 */
export async function getUserBadges(userId: string): Promise<Array<UserBadge & { label: string; description: string; criteria: string; category: string; color: string; glyph: string }>> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const snap = await userRef.collection(BADGES_SUBCOLLECTION).get();

  const existing = new Map<string, UserBadge>();
  snap.docs.forEach(d => existing.set(d.id, d.data() as UserBadge));

  // Lazy-backfill: any catalog badge missing from the user's subcollection
  // gets seeded as locked. Skip dynamic badges (ripeness — always present,
  // not a per-user unlock) and always-unlocked cosmetics (no doc needed).
  const missing = BADGE_CATALOG.filter(
    b => !b.dynamic && !b.alwaysUnlocked && !existing.has(b.id),
  );
  if (missing.length > 0) {
    const batch = db.batch();
    for (const b of missing) {
      const ref = userRef.collection(BADGES_SUBCOLLECTION).doc(b.id);
      const seed: UserBadge = { id: b.id, unlocked: false };
      batch.set(ref, stripUndefined(seed));
      existing.set(b.id, seed);
    }
    await batch.commit();
  }

  // Project in catalog order with static-copy overlay.
  return BADGE_CATALOG.map(b => {
    const state = existing.get(b.id) ?? { id: b.id, unlocked: false };
    return {
      ...state,
      label: b.label,
      description: b.description,
      criteria: b.criteria,
      category: b.category,
      color: b.color,
      glyph: b.glyph,
    };
  });
}

/**
 * Idempotently unlock a badge. Re-runs are safe — if the badge is
 * already unlocked, the existing unlockedAt is preserved. Returns true
 * if a state change happened, false if it was already unlocked.
 */
export async function unlockBadge(
  userId: string,
  badgeId: string,
  source?: Record<string, unknown>,
  opts?: { silent?: boolean },
): Promise<boolean> {
  if (!BADGE_BY_ID[badgeId]) return false; // unknown badge id
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const ref = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(BADGES_SUBCOLLECTION)
    .doc(badgeId);

  const wasNewlyUnlocked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as UserBadge) : null;
    if (existing?.unlocked) return false;
    const updated: UserBadge = {
      id: badgeId,
      unlocked: true,
      unlockedAt: nowIso(),
      ...(source ? { source } : {}),
    };
    tx.set(ref, stripUndefined(updated), { merge: true });
    return true;
  });

  // Real-time push to the user's event stream → bell + toast. Fire-and-forget.
  // `silent` skips it (ripeness tiers unlock quietly — no notification spam for
  // your banana ripening).
  if (wasNewlyUnlocked && !opts?.silent) {
    void pushStreamEvent(userId, 'badge-unlock', {
      badgeId,
      source: typeof source?.source === 'string' ? source.source : undefined,
    });
  }

  return wasNewlyUnlocked;
}

/**
 * Set or clear the user's equipped badge. Pass null to unequip.
 * Validates that the badge is unlocked before persisting.
 */
export async function equipBadge(
  userId: string,
  badgeId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);

  if (badgeId === null) {
    await userRef.set({ equippedBadge: null }, { merge: true });
    return { ok: true };
  }

  const badge = BADGE_BY_ID[badgeId];
  if (!badge) return { ok: false, reason: 'unknown badge id' };

  // Cosmetic badges (NFL team flair etc.) bypass the per-user unlock
  // check — they're available to everyone by design.
  if (!badge.alwaysUnlocked) {
    const badgeSnap = await userRef.collection(BADGES_SUBCOLLECTION).doc(badgeId).get();
    const data = badgeSnap.exists ? (badgeSnap.data() as UserBadge) : null;
    if (!data?.unlocked) return { ok: false, reason: 'badge not unlocked' };
  }

  await userRef.set({ equippedBadge: badgeId }, { merge: true });
  return { ok: true };
}

/**
 * Revoke a badge — used for the transient King of Drafts, which moves to a
 * new holder each week. Marks the badge locked again and clears it from the
 * user's equipped slot (so their avatar falls back to the banana). Returns
 * true if the user actually held it.
 */
export async function revokeBadge(userId: string, badgeId: string): Promise<boolean> {
  const db = getAdminFirestore();
  const lower = userId.toLowerCase();
  const userRef = db.collection(USERS_COLLECTION).doc(lower);
  const badgeRef = userRef.collection(BADGES_SUBCOLLECTION).doc(badgeId);

  const [badgeSnap, userSnap] = await Promise.all([badgeRef.get(), userRef.get()]);
  const held = badgeSnap.exists && (badgeSnap.data() as UserBadge).unlocked === true;

  await badgeRef.set({ id: badgeId, unlocked: false }, { merge: true });
  if (userSnap.exists && (userSnap.data() as User).equippedBadge === badgeId) {
    await userRef.set({ equippedBadge: null }, { merge: true });
  }
  return held;
}

/**
 * Count the PAID drafts a user has DONE — draft_entered activity events whose
 * passType is 'paid' (i.e. drafts they actually entered using a paid pass).
 * This is the ripeness metric: the banana ripens as you DRAFT, not as you buy.
 * Free drafts don't count (no free-draft farming). Single-field query on userId
 * (auto-indexed) + in-memory filter, so no composite index needed.
 */
export async function countPaidDraftsDone(userId: string): Promise<number> {
  const snap = await getAdminFirestore()
    .collection(ACTIVITY_EVENTS_COLLECTION)
    .where('userId', '==', userId.toLowerCase())
    .get();
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data() as { type?: string; metadata?: { passType?: string } };
    if (data.type === 'draft_entered' && data.metadata?.passType === 'paid') n++;
  }
  return n;
}

/**
 * Sync a user's banana ripeness from their PAID-drafts-DONE count (caller
 * supplies it via countPaidDraftsDone).
 *
 * Two effects, both idempotent:
 *  1. Denormalizes the current tier onto the user doc (`ripeness`) so every
 *     render site can show the right default banana without re-querying.
 *  2. Unlocks each ripeness tier badge the count has earned (so they become
 *     equippable). Crossing into a NEW tier fires a bell + toast (the unlock is
 *     idempotent, so it only fires once per tier).
 *
 * Returns the current (highest reached) tier.
 */
export async function computeAndStoreRipeness(userId: string, paidCount: number): Promise<Ripeness> {
  const lower = userId.toLowerCase();
  const ripeness = ripenessFromCount(paidCount);
  await getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(lower)
    .set({ ripeness }, { merge: true });
  // Unlock the earned tier badges (Unripe is always-unlocked → skip). Not
  // silent: ripening into a new tier should fire a bell + toast.
  for (const id of unlockedRipenessIds(paidCount)) {
    if (id === 'ripeness-unripe') continue;
    await unlockBadge(lower, id, { source: 'ripeness', paidCount });
  }
  return ripeness;
}

/**
 * Read just the equipped badge ids for a list of users — used by the
 * leaderboard / batch-render path so we don't N+1-query Firestore.
 */
export async function getEquippedBadgesBatch(userIds: string[]): Promise<Record<string, string | null>> {
  if (userIds.length === 0) return {};
  const db = getAdminFirestore();
  const refs = userIds.map(id => db.collection(USERS_COLLECTION).doc(id));
  const snaps = await db.getAll(...refs);
  const out: Record<string, string | null> = {};
  for (let i = 0; i < userIds.length; i++) {
    const data = snaps[i].exists ? (snaps[i].data() as User) : null;
    out[userIds[i]] = data?.equippedBadge ?? null;
  }
  return out;
}

/**
 * Batch read display fields (username, profilePicture, equippedBadge)
 * for a list of users. Used by the draft room so all 10 slot cards
 * can render real names + avatars + badges in one round-trip.
 *
 * Returns `null` username when the v2_users doc doesn't exist OR the
 * stored username is just the wallet — caller falls back to Go API.
 */
// Counter doc that hands out permanent, unique banana handle numbers.
// First handle is 10000 (always 5 digits), incrementing by 1 per user.
const BANANA_NUMBER_COUNTER_DOC = 'banana_user_number';
const BANANA_NUMBER_START = 10000;

// Assigns (once) and returns a permanent unique banana number for a user
// who has no username. Concurrency-safe via a Firestore transaction on a
// shared counter, so two users can never get the same number. Idempotent:
// returns the existing number if one was already assigned.
async function assignBananaNumber(userId: string): Promise<number> {
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const counterRef = db.collection('counters').doc(BANANA_NUMBER_COUNTER_DOC);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const existing = userSnap.exists ? (userSnap.data() as User).bananaNumber : undefined;
    if (typeof existing === 'number') return existing;
    const counterSnap = await tx.get(counterRef);
    const counterData = counterSnap.exists ? (counterSnap.data() as { next?: number }) : null;
    const next = typeof counterData?.next === 'number' ? counterData.next : BANANA_NUMBER_START;
    tx.set(counterRef, { next: next + 1 }, { merge: true });
    tx.set(userRef, { bananaNumber: next }, { merge: true });
    return next;
  });
}

export async function getUserDisplayBatch(userIds: string[]): Promise<Record<string, {
  username: string | null;
  profilePicture: string | null;
  equippedBadge: string | null;
  bananaNumber: number | null;
  ripeness: Ripeness | null;
}>> {
  if (userIds.length === 0) return {};
  const db = getAdminFirestore();
  const refs = userIds.map(id => db.collection(USERS_COLLECTION).doc(id));
  const snaps = await db.getAll(...refs);
  const out: Record<string, { username: string | null; profilePicture: string | null; equippedBadge: string | null; bananaNumber: number | null; ripeness: Ripeness | null }> = {};
  const needsAssignment: string[] = [];
  for (let i = 0; i < userIds.length; i++) {
    const data = snaps[i].exists ? (snaps[i].data() as User) : null;
    const id = userIds[i];
    const u = (data?.username || '').trim();
    // A username equal to the raw wallet means the user never set one.
    const username = u && u.toLowerCase() !== id ? u : null;
    const existingNumber = typeof data?.bananaNumber === 'number' ? data.bananaNumber : null;
    out[id] = {
      username,
      profilePicture: data?.profilePicture || null,
      equippedBadge: data?.equippedBadge ?? null,
      bananaNumber: existingNumber,
      // Denormalized ripeness tier (set by the badge sweep). Null until the
      // user's first sweep runs — the banana then defaults to Unripe.
      ripeness: data?.ripeness ?? null,
    };
    // Only users who actually SHOW a banana handle (no username set) and
    // don't have a number yet need one assigned.
    if (!username && existingNumber === null) needsAssignment.push(id);
  }
  // Assign permanent numbers for the unassigned. One transaction each, but
  // it only ever runs once per user — after that it's a plain read above.
  await Promise.all(needsAssignment.map(async (id) => {
    try {
      out[id].bananaNumber = await assignBananaNumber(id);
    } catch {
      // Assignment failed (transient): leave null, caller falls back to the
      // deterministic client-side placeholder. Never blocks the response.
    }
  }));
  return out;
}

// ── Persona Verification ──────────────────────────────────────────────

export interface VerifiedIdentityAddress {
  street?: string;
  city?: string;
  state?: string;
  parish?: string;
  zip?: string;
  country?: string;
}

export interface VerifiedIdentity {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  address?: VerifiedIdentityAddress;
  sessionId?: string;
  verifiedAt?: string;
}

export interface PersonaVerificationData {
  tier1: { verified: boolean; inquiryId?: string; verifiedAt?: string; geoState?: string };
  tier2: { verified: boolean; inquiryId?: string; verifiedAt?: string };
  cumulativeWithdrawals: number;
  // Set once at first KYC approval; reused at every withdrawal so we can
  // re-check the SBS-specific block rules (state/parish/age) without
  // re-prompting the user.
  verifiedIdentity?: VerifiedIdentity;
  // Per-tax-year withdrawal totals (Phase 2 W9 trigger uses this).
  withdrawnByYear?: Record<string, number>;
  // Per-tax-year W9 submission status.
  hasW9?: Record<string, boolean>;
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
  // Defensive merge with DEFAULT_PERSONA. verify/submit only writes
  // tier1 + verifiedIdentity, so tier2 is missing from real docs on
  // disk. Without this, /api/eligibility crashes with
  // "Cannot read properties of undefined (reading 'verified')" on
  // tier2.verified — which silently 500s and the frontend falls back
  // to "Verification Required" forever even after a successful KYC.
  const data = doc.data() as Partial<PersonaVerificationData>;
  return {
    tier1: data.tier1 ?? { verified: false },
    tier2: data.tier2 ?? { verified: false },
    cumulativeWithdrawals: data.cumulativeWithdrawals ?? 0,
    ...(data.verifiedIdentity ? { verifiedIdentity: data.verifiedIdentity } : {}),
    ...(data.withdrawnByYear ? { withdrawnByYear: data.withdrawnByYear } : {}),
    ...(data.hasW9 ? { hasW9: data.hasW9 } : {}),
  };
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
