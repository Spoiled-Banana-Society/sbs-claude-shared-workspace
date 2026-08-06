import crypto from 'node:crypto';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { API_CONFIG, getUsdcPaymentAddressOrThrow, isBuyBonusActive } from '@/lib/api/config';
import { ApiError } from '@/lib/api/errors';
import { seedDb } from '@/lib/api/seed';
import { logger } from '@/lib/logger';
import { promoWeekendActive } from '@/lib/promoWindow';
import { LOG_SOURCES } from '@/lib/logSources';
import { verifyPurchaseTx } from '@/lib/onchain/verifyPurchaseTx';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { logActivityEvent } from '@/lib/activityEvents';
import { bananaDefaultName, bananaPlaceholderName } from '@/utils/helpers';
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
import { pushStreamEventBg } from '@/lib/userEventStream';
import { createNotification } from '@/lib/queueNotifications';
import { applyCompletionGate, computeFirstPurchaseGrant, computeMintProgress } from '@/lib/promoMath';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { runInBackground } from '@/lib/serverBackground';

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
  // Clean default referral code = the user's default Banana##### handle with
  // non-alphanumerics stripped (e.g. "Banana24789"). Matches the default that
  // ensureNamedReferralCode mints, so the seed/heal path and the name-based
  // path produce the SAME clean code — no more hash placeholder
  // (BANANA-XXXX-XXXX). Because this contains no hyphen, the heal condition
  // below (`startsWith('BANANA-')`) only ever matches OLD hash codes, so it
  // migrates them once to this clean code and then leaves it alone — and never
  // touches a user's edited name code. (Boris 2026-06-15)
  return sanitizeRefName(bananaDefaultName(userId.toLowerCase()));
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
  // Env-driven so prod referral links use the prod domain. Falls back to the
  // staging URL when NEXT_PUBLIC_SITE_URL is unset (staging) — unchanged there.
  const link = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app'}?ref=${code}`;
  const referralPromo = promos.find((p) => p.type === 'referral');
  if (referralPromo) {
    referralPromo.modalContent.inviteCode = code;
    referralPromo.modalContent.referralLink = link;
  }

  const badges = deepClone(seedDb.badgesByUser['1'] ?? seedUserBadges());
  // A brand-new user has drafted NOTHING and spun NOTHING — start their
  // exposure, draft history AND wheel-spin history EMPTY. (We used to clone
  // mock user #1's demo data — `seedDb.exposureByUser['1']` = 20 fake drafts
  // "KC QB 35% / PHI QB 25%…", 3 fake completed drafts, and 5 fake wheel spins
  // incl. a claimed jackpot win — the same mock-template leak the
  // walletAddress/username overrides above (line ~154) were added to fix, but
  // these subcollections were missed. Real data is written by
  // recomputeUserExposure / draft completion / actual spins once they play.)
  // NOTE: badges + promos ARE seeded on purpose (badges = LOCKED placeholders
  // checked via unlocked===true; promos = the shared promo catalog).
  const wheelSpins: WheelSpin[] = [];
  const exposure: UserExposure = { username: user.username, totalDrafts: 0, exposures: [] };
  const draftHistory: CompletedDraft[] = [];
  const referral = { code, createdAt: todayDate() };

  return { user, promos, wheelSpins, badges, exposure, draftHistory, referral };
}

export async function ensureUserSeeded(userId: string): Promise<User> {
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const snap = await userRef.get();
  // A doc with a `username` is FULLY seeded → cheap idempotent return.
  // A *partial* doc (no username) was created by an early merge-write from a
  // co-located endpoint — /api/badges (lastBadgeSweepAt/ripeness), the
  // activity touch (lastActiveAt), or returning-check (firstLoginAt) — that
  // raced ahead of the seed. The old `if (snap.exists)` bail treated those
  // bare docs as "already seeded" and PERMANENTLY skipped seeding, so the
  // user ended up with no username, no promos, no badges and no welcome bell.
  // `username` is a safe marker: only this seed and the profile setters (which
  // call ensureUserSeeded first) ever write it — no partial writer does.
  const existing = snap.exists ? (snap.data() as Partial<User>) : null;
  if (existing && existing.username) return existing as User;

  const seed = buildSeedUser(userId);
  const batch = db.batch();

  // Denormalized lowercase username powers case-insensitive friend search.
  // Keep this in sync at every write site that touches `username`.
  const seedUserWithLower = {
    ...seed.user,
    username_lower: seed.user.username ? seed.user.username.toLowerCase() : undefined,
  };
  // MERGE, not overwrite. A fresh account's first load fires several API calls
  // at once; a co-located writer can create a PARTIAL doc before this seed runs
  // — most importantly `assignBananaNumber` (display-batch), which merge-writes
  // the user's permanent `bananaNumber`. A plain (non-merge) set here WIPED that
  // number, so the next display re-assigned a NEW one — the default handle
  // visibly changed (e.g. Banana10156 → 10157 after a refresh) and the wiped
  // number leaked as an orphaned gap. Merging preserves any pre-written
  // co-located fields (bananaNumber, profilePicture, ripeness, lastActiveAt,
  // firstLoginAt) while still writing every seed field. Safe because we only
  // reach here when there's no `username` yet (bare partial doc); the seed sets
  // all the canonical fields explicitly. (Boris 2026-07-05)
  batch.set(userRef, stripUndefined(seedUserWithLower), { merge: true });

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

  // ONE-SEEDER CLAIM: a fresh account's first page load fires several API
  // calls concurrently; each sees "no username yet" and runs this seed. The
  // seed WRITES are idempotent, but the signup EVENTS below are not — every
  // racer used to log its own "New account" row (Boris 2026-07-03: "why does
  // it show twice?"; one wallet had six). create() is atomic: exactly one
  // caller wins and emits; losers skip events but still return the seed.
  let firstSeeder = false;
  try {
    await userRef.collection('metadata').doc('seedClaim').create({ at: new Date().toISOString() });
    firstSeeder = true;
  } catch { /* claimed by a concurrent seeder — events already emitted */ }

  // Fire-and-forget signup event (first-time seed)
  if (firstSeeder) {
    try {
      const { logUserEvent } = await import('@/lib/userEvents');
      void logUserEvent(userId, 'signup');
    } catch {
      // non-fatal
    }
  }

  // Admin Live Activity: "New account" event, tagged new vs returning.
  // At seed time only the past-players WALLET snapshot can answer that —
  // the web2 email/X identity match (returning-check) runs moments later
  // on the same login, so a web2 returnee's row may read NEW here while
  // their user record (and every chip) flips to returning seconds after.
  if (firstSeeder) {
    try {
      const [{ logActivityEvent }, { isReturningWalletSync }] = await Promise.all([
        import('@/lib/activityEvents'),
        import('@/lib/returningUsers'),
      ]);
      const isReturning = isReturningWalletSync(userId);
      void logActivityEvent({
        type: 'user_signed_up',
        userId,
        metadata: { isReturning, isNewAccount: !isReturning, firstSession: true },
      });
    } catch {
      // non-fatal
    }
  }

  // Welcome bell notification (Boris 2026-06-10): every new user gets ONE
  // persisted noti explaining how to earn their free spin, linking straight
  // to the new-user promo modal. Dedupe-keyed → exactly once per account.
  // AWAITED — a `void` fire-and-forget can die when the lambda freezes
  // after the response (the same failure that ate promo notis pre-June-9).
  try {
    const { isReturningWalletSync } = await import('@/lib/returningUsers');
    if (isReturningWalletSync(userId)) throw new Error('returning player — no welcome noti');
    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(userId, {
      type: 'welcome',
      title: 'Welcome! Free Spin Waiting',
      message: 'Verify your X account to earn a Free Banana Spin — win up to 20 free drafts, at least 1 guaranteed. Tap to claim.',
      link: '/promos?promo=6',
      dedupeKey: 'welcome-new-user',
      icon: 'party',
    });
  } catch {
    // non-fatal
  }

  return seed.user;
}

function calcSpinsForPurchase(quantity: number): number {
  return Math.floor(quantity / API_CONFIG.purchases.spinsPerPasses);
}

function calcBuyBonusFreeDrafts(quantity: number): number {
  if (!isBuyBonusActive()) return 0;
  // In 'spin' mode the reward is a wheel spin granted on CLAIM (claim path in
  // claimPromo) — this legacy auto-grant of free drafts must stay at 0 or the
  // verifyPurchase path would hand out drafts on top of the claimable spin.
  if (API_CONFIG.promos.buyBonus.reward !== 'draft') return 0;
  return Math.floor(quantity / API_CONFIG.promos.buyBonus.buy) * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
}

export async function getPromos(userId: string): Promise<Promo[]> {
  const db = getAdminFirestore();
  const userData = await ensureUserSeeded(userId);

  // RETURNING-USER GUARD (2026-06-27): a player from a past BBB season is NOT
  // eligible for the new-user bonus — unless an admin force-granted it
  // (newUserPromoForced). Returning = the email/social returning-check flag OR
  // the static past-players wallet list. The authoritative enforcement is in
  // claimPromo (server-side); here we just hide it + keep it un-claimable.
  const { isReturningWalletSync } = await import('@/lib/returningUsers');
  const forcedNewUser = (userData as { newUserPromoForced?: boolean }).newUserPromoForced === true;
  const newUserBlocked = !forcedNewUser
    && ((userData as { isReturningPlayer?: boolean }).isReturningPlayer === true || isReturningWalletSync(userId));

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
  // ONLY heal missing/legacy machine codes (`BANANA-…` with hyphens) — a
  // name-based code from ensureNamedReferralCode must never be overwritten
  // (sanitized names contain no hyphen, so the prefix check can't collide).
  const expectedCode = buildPerUserReferralCode(userId);
  const expectedLink = `${REFERRAL_SITE_URL}/r/${expectedCode}`;
  const referralPromoToFix = allDocs.find(
    (p) => p.type === 'referral'
      && (!p.modalContent.inviteCode || p.modalContent.inviteCode.startsWith('BANANA-'))
      && p.modalContent.inviteCode !== expectedCode,
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
        const codeRef = db.collection(REFERRAL_CODES_COLLECTION).doc(expectedCode.toUpperCase());
        const codeSnap = await codeRef.get();
        const batch = db.batch();
        batch.set(
          promoRef,
          { modalContent: { inviteCode: expectedCode, referralLink: expectedLink } },
          { merge: true },
        );
        batch.set(referralMetaRef, { code: expectedCode, base: expectedCode.toUpperCase() }, { merge: true });
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

  // The Pick-slot promo is a LIVE LADDER — its title + NEW badge track the
  // batch's current tier so the CARD matches the broadcast bells
  // (announcePick10ExpansionIfActivated):
  //   base (Jackpot still hiding)    → "Pick 10 → FREE SPIN",        no NEW
  //   jp   (Jackpot hit)             → "Pick 6 & 10 → FREE SPINS"     no NEW
  //   all  (Jackpot + all 5 HOF hit) → "Pick 6, 9 & 10 → FREE SPINS"  + NEW  ← only tier with the NEW badge
  // Reverts to base automatically when the next 100-batch begins. The modal
  // explanation covers the full escalating ladder in every tier. (isNew is set
  // here, server-side — promoFilter no longer forces it off for pick-10.)
  // DISPLAY tier (not the credit tier): at a batch boundary this reverts to
  // base ("Pick 10") the instant the batch's last draft fills, so the card never
  // confuses people by still advertising "Pick 6, 9 & 10" after the batch ended.
  // Crediting is unaffected — reveal-complete still uses getPick10ActiveSlots.
  let pickTier: 'base' | 'jp' | 'all' = 'base';
  let pickRolling = false;
  try {
    const dt = await getPick10DisplayTier();
    pickTier = dt.tier;
    pickRolling = dt.rolling;
  } catch { /* fall back to base copy */ }
  // Rolling era: the ladder is retired — simple era-neutral Pick-10 copy
  // (the legacy explanation promised tiers that can no longer trigger).
  const PICK_BASE_EXPLANATION = promoWeekendActive()
    ? '• Hit Pick 10 in any draft → Free Banana Spin.\n'
      + '• FREE and paid drafts BOTH count.\n'
      + '• Every Spin wins Free Drafts — up to 20, minimum 1.\n'
      + '• Through Sunday 12pm PT.'
    : '• Hit Pick 10 in any paid draft → Free Banana Spin.\n'
      + '• Every Spin wins Free Drafts — up to 20, minimum 1.\n'
      + '• Paid Drafts Only.';
  const PICK_LADDER_EXPLANATION =
    '• Hit Pick 10 in any paid draft → Free Banana Spin.\n'
    + '• When this batch’s Jackpot is hit, Pick 6 unlocks too — Pick 6 & 10 each win a Free Spin.\n'
    + '• When every special is gone (Jackpot + all 5 HOF), Pick 9 unlocks too — Pick 6, 9 & 10 each win a Free Spin.\n'
    + '• The reward escalates as the batch’s chase prizes run out, then resets when the next 100-draft batch begins.\n'
    + '• Every Spin wins Free Drafts — up to 20, minimum 1.\n'
    + '• Paid Drafts Only.';
  const PICK_TIER_COPY: Record<'base' | 'jp' | 'all', { title: string; description: string; isNew: boolean }> = promoWeekendActive()
    ? {
      // Weekend window copy — same slots, but free & paid drafts both count.
      base: { title: 'Pick 10 → FREE SPIN', description: 'Hit Pick 10 in ANY draft — free & paid count thru Sun 12pm PT!', isNew: true },
      jp: { title: 'Pick 6 & 10 → FREE SPINS', description: 'Jackpot hit — Picks 6 & 10 each win a Free Spin. Free & paid count thru Sun 12pm PT!', isNew: true },
      all: { title: 'Pick 6, 9 & 10 → FREE SPINS', description: 'All specials hit — Picks 6, 9 & 10 each win a Free Spin. Free & paid count thru Sun 12pm PT!', isNew: true },
    }
    : {
      base: { title: 'Pick 10 → FREE SPIN', description: 'Hit Pick 10 in a paid draft for a Free Spin', isNew: false },
      jp: { title: 'Pick 6 & 10 → FREE SPINS', description: 'Jackpot hit — Pick 6 & 10 each win a Free Spin', isNew: false },
      all: { title: 'Pick 6, 9 & 10 → FREE SPINS', description: 'All specials hit — Pick 6, 9 & 10 each win a Free Spin', isNew: true },
    };

  // First-purchase promo has TWO variants since 2026-07-10 (Boris): the seed
  // carries the NEW-player copy (every pass = 2 Spins, $1K framing); RETURNING
  // players keep the CLASSIC promo unchanged — these strings overlay theirs.
  // The grant math matches per-audience in _incrementMintPromosInTx.
  const CLASSIC_FIRST_PURCHASE_COPY = {
    title: 'First Purchase → FREE SPINS',
    description: 'Every 2 passes on your first buy = 1 spin',
    modalTitle: 'First Purchase → FREE SPINS',
    explanation:
      '• Your very first draft-pass purchase earns Free Banana Spins — every 2 passes = 1 Free Banana Spin.\n• Buy 4 for 2, buy 6 for 3, and so on — no limit.\n• One-time offer: applies only to your first purchase, so buy them all in one transaction to lock in the most Spins.\n• After you buy, claim your Spins right here.',
  };
  const isReturningUser = (userData as { isReturningPlayer?: boolean }).isReturningPlayer === true
    || isReturningWalletSync(userId);

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
        // The Earn Spins tier list is STATIC COPY too (the 1/4/10 ladder) —
        // without this overlay, users seeded before a copy change keep the
        // old tiers forever (caught by Boris 2026-06-11).
        if (seed.modalContent.referralRewards !== undefined) {
          promo.modalContent.referralRewards = seed.modalContent.referralRewards;
        }
      }
    }
    // Weekend window (auto-reverts Sun 12pm PT): free drafts count too — strip
    // the paid-only language from the draft-based promos' copy and say so.
    if (promoWeekendActive() && (promo.type === 'daily-drafts' || promo.type === 'jackpot')) {
      const dePaid = (t: string | undefined): string | undefined =>
        t === undefined ? undefined : t.replace(/\bpaid draft/gi, 'draft').replace(/\bPaid Drafts Only\.?/gi, '').trim();
      promo.title = dePaid(promo.title) ?? promo.title;
      const desc = dePaid(promo.description) ?? promo.description;
      promo.description = desc ? `${desc} · Free drafts count thru Sun 12pm PT` : desc;
      if (promo.modalContent?.explanation) {
        const lines = promo.modalContent.explanation
          .split('\n')
          .map((l: string) => dePaid(l) ?? l)
          .filter((l: string) => l && l !== '•');
        lines.push('• This week: FREE and paid drafts BOTH count (through Sunday 12pm PT)!');
        promo.modalContent.explanation = lines.join('\n');
      }
    }
    // Expired daily-drafts window reads as a fresh 0/4 + 24:00:00 everywhere.
    // The STORED doc resets lazily (recordDraftCompletion zeroes it when the
    // next paid draft fills), but showing the stale "2/4 · 0:00:00" in the
    // meantime contradicted the rules ("after 24 hours it resets"). Read-side
    // normalization only — no write.
    // Reset the in-progress CYCLE for display when it's expired or orphaned.
    // NOTE: deliberately NOT gated on !claimable — unclaimed spins (claimable/
    // claimCount) are SEPARATE from the cycle. Gating on !claimable left users
    // with a pending CLAIM stuck showing a stale "2/4 · 0:00:00". We reset only
    // progress + timer here; the CLAIM button (claimable/claimCount) is untouched.
    if (promo.type === 'daily-drafts' && dailyDraftCycleNeedsReset(promo)) {
      promo.progressCurrent = 0;
      promo.timerEndTime = undefined;
    }
    // Stacking promos (Buy-10 spin, buy-bonus) roll over at the milestone.
    // Docs written before the rollover change (2026-07-01) stored a full bar
    // (10/10) on an exact-multiple landing, which read as "done, can't earn
    // again". Normalize those legacy values at read — no write; the milestone
    // delta math in computeMintProgress handles either stored form.
    if (promo.type === 'mint' || promo.type === 'buy-bonus') {
      const stackMax = promo.progressMax || 0;
      if (stackMax > 0 && (promo.progressCurrent || 0) >= stackMax) {
        promo.progressCurrent = (promo.progressCurrent || 0) % stackMax;
      }
    }
    // Inject real twitterConnected status for promos that depend on it
    if (promo.type === 'new-user' || promo.type === 'tweet-engagement') {
      promo.modalContent.twitterConnected = hasVerifiedTwitter;
    }
    // Stamp the force-grant so the CLIENT filter can show the new-user promo to a
    // returning player (it otherwise hides any new-user promo when isBB3Holder).
    // Claimed/spun hides still apply client-side — this only overrides the
    // returning-player hide. Mirrors the server newUserBlocked override.
    if (promo.type === 'new-user') {
      promo.forced = forcedNewUser;
    }
    // New-user promo unlocks the moment Twitter is verified. Promo doc itself
    // doesn't carry claim state — the v2_twitter_links record's
    // newUserPromoClaimed is the source of truth (so the promo stays
    // claimable across Firestore re-seeds and resists race conditions).
    if (promo.type === 'new-user' && hasVerifiedTwitter && !newUserPromoAlreadyClaimed && !newUserBlocked) {
      promo.claimable = true;
      promo.claimCount = Math.max(promo.claimCount ?? 0, 1);
    }
    // Returning players keep the CLASSIC first-purchase promo copy (their
    // rate is unchanged) — overlay it AFTER the static seed overlay so the
    // new-player $1K copy never reaches them.
    if (promo.type === 'first-purchase' && isReturningUser) {
      promo.title = CLASSIC_FIRST_PURCHASE_COPY.title;
      promo.description = CLASSIC_FIRST_PURCHASE_COPY.description;
      promo.modalContent = promo.modalContent || {};
      promo.modalContent.title = CLASSIC_FIRST_PURCHASE_COPY.modalTitle;
      promo.modalContent.explanation = CLASSIC_FIRST_PURCHASE_COPY.explanation;
    }
    // Pick-slot promo: overlay the LIVE tier copy (title + NEW badge + full
    // ladder explanation) AFTER the static seed overlay above, so the card
    // reflects the batch's current tier and matches the bells.
    if (promo.type === 'pick-10') {
      const c = PICK_TIER_COPY[pickTier];
      promo.title = c.title;
      promo.description = c.description;
      promo.isNew = c.isNew;
      promo.modalContent = promo.modalContent || {};
      promo.modalContent.title = c.title;
      promo.modalContent.explanation = pickRolling ? PICK_BASE_EXPLANATION : PICK_LADDER_EXPLANATION;
    }
    return promo;
  }).filter((promo) => !(promo.type === 'new-user' && newUserBlocked)); // returning players never see the new-user promo (unless force-granted)
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
        // RETURNING-USER GUARD (2026-06-27): a past-season BBB player is NOT
        // eligible for the new-user bonus — UNLESS an admin force-granted it
        // (newUserPromoForced). Enforced HERE, inside the claim transaction, so
        // it's authoritative and a hand-crafted client request can't bypass it.
        // Returning = the email/social returning-check flag OR the static
        // past-players wallet list. (newUserPromoForced is admin-only; no
        // user-facing route writes it.)
        const { isReturningWalletSync } = await import('@/lib/returningUsers');
        const forced = (user as { newUserPromoForced?: boolean }).newUserPromoForced === true;
        const isReturning = (user as { isReturningPlayer?: boolean }).isReturningPlayer === true
          || isReturningWalletSync(userId);
        if (isReturning && !forced) {
          throw new ApiError(403, 'Returning players are not eligible for the new-user bonus');
        }
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
        // Must list EVERY paid milestone in the 1→4→10 ladder. 'bought4' was
        // missing here, so a friend hitting 4 lifetime passes fired + rang the
        // bell but threw "Nothing to claim" on claim and got stuck (Boris
        // 2026-06-25). 'verified' never reaches 'claim' (it goes straight to
        // 'claimed' on verify), so listing it is harmless.
        const keys: Array<keyof NonNullable<typeof entry.rewards>> = ['verified', 'bought1', 'bought4', 'bought10'];
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

    // Buy-bonus in 'draft' mode awards free drafts; in 'spin' mode (July 4th
    // 2026 config) it falls through to the wheel-spin path like every other
    // promo. When on-chain admin mint is configured, free-draft awards ALSO
    // mint real BBB4 NFTs after the tx commits (dual-write — counter + NFT
    // stay in sync).
    const draftPassCount =
      promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft'
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
    // Reset the progress bar after claiming so the next cycle starts at 0 —
    // EXCEPT promos whose progressCurrent is a CARRYOVER counter that lives
    // across the claim (zeroing it on claim throws away in-progress work):
    //   • daily-drafts: progressCurrent is the in-progress 24h cycle — zeroing
    //     it wiped a cycle the user was already part-way through.
    //   • referral: progressCurrent is the cumulative referral count (rewards
    //     live in referralHistory) — zeroing it desynced the count display.
    //   • mint ("Buy 10 → FREE SPIN") + buy-bonus: progressCurrent is the
    //     running pass count toward the NEXT milestone — createPurchase reads
    //     the stored value (computeMintProgress / bbCurrent) and adds to it, so
    //     it carries across purchases. Zeroing it on claim discarded passes the
    //     user already bought toward their next spin (Boris's "1/10 → 0/10"
    //     report on 0xc7900…). The earned spin lives in claimCount, which IS
    //     drained above — only the carryover bar must survive.
    // Per-event / one-time promos (pick-10, jackpot, new-user, first-purchase)
    // use progressCurrent as a flag recomputed on the next event, so the reset
    // is harmless for them — keep it.
    const ownsProgressElsewhere =
      promo.type === 'daily-drafts' ||
      promo.type === 'referral' ||
      promo.type === 'mint' ||
      promo.type === 'buy-bonus';
    if (promo.progressMax !== undefined && !ownsProgressElsewhere) {
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

    // Metrics event — runInBackground (NOT `void`): detached promises are
    // killed by the Vercel lambda freeze after the response (Rule: bells were
    // being dropped this way — jetsonjets22's claims committed but no
    // "Promo Claimed!" bell ever landed, 2026-07-10).
    try {
      const { logUserEvent } = await import('@/lib/userEvents');
      runInBackground('promo-claim-metrics', logUserEvent(userId, 'promo_claimed', {
        promoId,
        promoType: result.promo.type,
        spinsAdded: result.spinsAdded,
      }));
    } catch { /* non-fatal */ }

    // Server-side "Promo Claimed!" notification — fired the instant the claim
    // commits so it reaches every device in real-time (content-carrying ping).
    // runInBackground/waitUntil, NOT `void` — this bell is the user's only
    // confirmation the claim worked (toasts removed 2026-07-10), so dropping
    // it reads as "the claim button is broken".
    if (result.spinsAdded > 0) {
      // Key off what was actually granted (draftPassCount), not the promo
      // type — buy-bonus grants spins when configured reward === 'spin'.
      const grantedDrafts = result.draftPassCount > 0;
      runInBackground('promo-claim-bell', createNotification(userId, {
        type: 'promo',
        title: 'Promo Claimed!',
        message: grantedDrafts
          ? `You earned ${result.draftPassCount} free draft pass${result.draftPassCount !== 1 ? 'es' : ''}!`
          : `You earned ${result.spinsAdded} wheel spin${result.spinsAdded !== 1 ? 's' : ''}!`,
        link: grantedDrafts ? '/drafting' : '/banana-wheel',
        icon: grantedDrafts ? 'ticket' : 'spin',
      }));
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
  return ensureNamedReferralCode(userId, username);
}

const REFERRAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app';

/** Strip a display name down to a clean code: letters+digits only, max 16. */
function sanitizeRefName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
}

/**
 * Name-based referral code (Boris 2026-06-10): the share link ends in the
 * user's display name — `…/r/BorisV` — short and clean. Uses their edited
 * name when set, else the default Banana##### name. The code doc id is the
 * UPPERCASED name (lookups are case-insensitive); on a name collision we
 * append 2, 3, … . When the user renames, the next read mints a fresh code
 * for the new name — old codes stay in v2_referral_codes so links already
 * shared keep resolving to them.
 */
export async function ensureNamedReferralCode(userId: string, _displayName?: string) {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);

  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const referralRef = userRef.collection('metadata').doc(REFERRAL_DOC);

  // SECURITY (2026-06-27): the referral code is derived from the user's OWN
  // claimed username — read server-side from their user doc, which claimUsername
  // writes atomically on every name-set path — NOT from a client-supplied name.
  // Trusting the passed name let a user mint a code for a name they don't own,
  // squatting it and forcing the real username-owner onto "Name2" (the AceJohn
  // bug). A user still on the default "User-…" placeholder falls back to their
  // default Banana##### handle (the same name they see). `_displayName` is now
  // ignored on purpose.
  const userSnap = await userRef.get();
  const stored = (userSnap.data()?.username as string | undefined) || '';
  // Default handle = the SERVER-ASSIGNED unique number (assigning one on the
  // spot when missing), never the wallet hash — the hash's 90k space collides,
  // so two users could mint the SAME default referral code (and it must match
  // the handle the header/display-batch now shows). Placeholder only if the
  // assignment transiently fails.
  const lowerId = userId.toLowerCase();
  const storedNumber = userSnap.data()?.bananaNumber as number | undefined;
  const defaultName = typeof storedNumber === 'number'
    ? `Banana${storedNumber}`
    : await assignBananaNumber(lowerId).then((n) => `Banana${n}`).catch(() => bananaPlaceholderName(lowerId));
  let ownName: string;
  if (stored && !stored.startsWith('User-')) {
    // A claimed new-system username — authoritative, and written in the SAME
    // claim that calls this (POST /api/username), so it's race-safe on edit.
    ownName = stored;
  } else {
    // No claimed username yet. RETURNING users carry their real name in the
    // owners/Go-API DISPLAY store (owners.PFP.DisplayName), NOT v2_users.username,
    // so the referral must mirror the DISPLAYED name — otherwise the header shows
    // "RisBrian" while the link stays the default /r/Banana#####. Server-side read
    // of their OWN owners doc (not a client-supplied name → no squatting vector);
    // falls back to the Banana default when the display name is itself a
    // placeholder (User-…/0x…/empty/the app's old hash-name echo), i.e. a
    // genuine new user who hasn't edited.
    const ownerSnap = await db.collection('owners').doc(lowerId).get();
    const ownerDisplay = (ownerSnap.data() as { PFP?: { DisplayName?: string } } | undefined)?.PFP?.DisplayName?.trim() || '';
    const ownerIsReal = !!ownerDisplay
      && !/^user-0x[0-9a-fA-F]/i.test(ownerDisplay)
      && !/^0x[0-9a-fA-F]{4,}/.test(ownerDisplay)
      && ownerDisplay.toLowerCase() !== lowerId
      // The Go store's copy of the wallet's own HASH default is the app's old
      // auto-sync echo, not a chosen name.
      && ownerDisplay !== bananaDefaultName(lowerId);
    ownName = ownerIsReal ? ownerDisplay : defaultName;
  }
  const base = sanitizeRefName(ownName) || sanitizeRefName(defaultName);

  // Already minted for this exact name → reuse (no writes on the hot path).
  const metaSnap = await referralRef.get();
  const meta = metaSnap.data() as { code?: string; base?: string } | undefined;
  if (meta?.code && meta?.base === base.toUpperCase()) {
    return { code: meta.code, link: `${REFERRAL_SITE_URL}/r/${meta.code}` };
  }

  // Find a free id: NAME, NAME2 … NAME99 (id uppercase; pretty case kept in doc).
  let pretty = base;
  for (let n = 2; n <= 99; n++) {
    const snap = await db.collection(REFERRAL_CODES_COLLECTION).doc(pretty.toUpperCase()).get();
    if (!snap.exists || (snap.data() as { userId?: string }).userId === userId) break;
    pretty = `${base}${n}`;
  }
  const code = pretty;
  const link = `${REFERRAL_SITE_URL}/r/${code}`;
  const codeRef = db.collection(REFERRAL_CODES_COLLECTION).doc(code.toUpperCase());

  await db.runTransaction(async (tx) => {
    const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));
    const referralPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'referral');

    tx.set(referralRef, stripUndefined({ code, base: base.toUpperCase(), createdAt: todayDate() }), { merge: true });
    tx.set(codeRef, { userId, code }, { merge: true });

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

    // Stamp a clean fallback name — the modal live-resolves via
    // display-batch, but this is what shows if that lookup ever misses.
    // Placeholder junk ("User-0x12ab", raw wallets) becomes the canonical
    // wallet-derived banana handle, same as the user's own header.
    const cleanUsername =
      referredUsername && !/^user-?[0-9a-fx]/i.test(referredUsername.trim()) && !/^0x[0-9a-f]{6,}/i.test(referredUsername.trim())
        ? referredUsername.trim()
        // Server-assigned number from the doc already read in this tx — never
        // the wallet hash (collides across users).
        : (typeof referredUser.bananaNumber === 'number'
            ? `Banana${referredUser.bananaNumber}`
            : bananaPlaceholderName(referredUserId));
    const entry: ReferralEntry = {
      username: cleanUsername,
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

    if (milestone === 'verified') {
      // Verified pays the referrer NOTHING by itself (kills verify-farming)
      // — but it UNLOCKS the mint ladder. Fire any milestones the friend's
      // prior purchases already earned (buys-before-verify aren't lost).
      entry.rewards.verified = 'claimed';
      (entry as { verifiedAt?: string }).verifiedAt = new Date().toISOString();
      if (entry.rewards.bought4 === undefined) entry.rewards.bought4 = 'pending';
      const lateLadder: Array<{ key: 'bought1' | 'bought4' | 'bought10'; at: number }> = [
        { key: 'bought1', at: 1 },
        { key: 'bought4', at: 4 },
        { key: 'bought10', at: 10 },
      ];
      let lateFired = 0;
      for (const t of lateLadder) {
        if ((entry.draftsPurchased || 0) >= t.at && entry.rewards[t.key] === 'pending') {
          entry.rewards[t.key] = 'claim';
          entry.status = 'claim';
          entry.milestoneDates = { ...(entry.milestoneDates || {}), [t.key]: new Date().toISOString() };
          promo.claimCount = (promo.claimCount || 0) + 1;
          promo.claimable = true;
          lateFired += 1;
        }
      }
      tx.set(referralPromoDoc.ref, stripUndefined(promo), { merge: true });
      return { updated: true, referrerUserId, lateFired, friendName: entry.username, friendTotal: entry.draftsPurchased || 0 };
    }

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
      const late = (result as { lateFired?: number; friendName?: string; friendTotal?: number }).lateFired ?? 0;
      if (late > 0) {
        // Friend-specific noti (names them) — covers live + bell on its own.
        // Do NOT also emit the generic 'referral-milestone' event, or the
        // referrer gets two pings for one event.
        void (async () => {
          try {
            const { createNotification } = await import('@/lib/queueNotifications');
            await createNotification(result.referrerUserId as string, {
              type: 'referral',
              title: late === 1 ? 'Free Spin to Claim!' : `${late} Free Spins to Claim!`,
              message: `${(result as { friendName?: string }).friendName ?? 'Your referral'} verified their X — their ${(result as { friendTotal?: number }).friendTotal ?? 0} passes unlocked your ${late === 1 ? 'Free Banana Spin' : 'Free Banana Spins'}. Claim now.`,
              link: '/promos?promo=3',
              dedupeKey: `ref-late-${referredUserId}`,
              icon: 'users',
            });
          } catch { /* best-effort */ }
        })();
      } else {
        // No friend-specific noti for this milestone — fire the single generic ping.
        pushStreamEventBg(result.referrerUserId, 'referral-milestone', { milestone });
      }
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

  // NOTE: NO club badge unlock at spin time (Boris 2026-06-10). A wheel-won
  // JP/HOF draft unlocks the club badge when that queue DRAFT FILLS — fired
  // by the draft-filled webhook (source: queue-draft-filled).

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
 * Fire a real-time server bell the moment a draft-pass purchase confirms (Boris:
 * every successful buy gets a bell). Idempotent per purchase via `dedupeId`
 * (a txHash or purchaseId), so a retry / double-call can't double-bell. Best
 * effort — never throws into the purchase path.
 */
export async function notifyPassPurchased(userId: string, quantity: number, dedupeId: string): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0 || !userId) return;
  try {
    await createNotification(userId.toLowerCase(), {
      type: 'purchase_complete',
      title: quantity === 1 ? 'Draft Pass purchased' : `${quantity} Draft Passes purchased`,
      message: quantity === 1
        ? 'Your Draft Pass is ready — jump into a draft!'
        : `Your ${quantity} Draft Passes are ready — jump into a draft!`,
      link: '/draft',
      dedupeKey: `pass-buy-${dedupeId}`,
      icon: 'ticket',
    });
  } catch (err) {
    console.warn('[notifyPassPurchased] failed:', err);
  }
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
): Promise<{ mintMilestonesEarned: number; buyBonusMilestonesEarned: number; firstPurchaseSpinsEarned: number; newTotalMinted: number }> {
  // READS FIRST — Firestore requires every read before any write in a tx.
  const promosSnap = await tx.get(userRef.collection(PROMOS_SUBCOLLECTION));
  // Only the wrapper-driven paid paths (card-mint / staging-mint) handle the
  // first-purchase bonus; the legacy verifyPurchase path writes userRef itself
  // and opts out to avoid a double-write to the user doc.
  const userSnap = opts.handleFirstPurchase ? await tx.get(userRef) : null;

  let mintMilestonesEarned = 0;
  let newTotalMinted = 0;
  const mintPromoDoc = promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'mint');
  if (mintPromoDoc) {
    const mintPromo = deepClone(mintPromoDoc.data() as Promo);
    mintPromo.modalContent.totalMinted = (mintPromo.modalContent.totalMinted || 0) + quantity;
    newTotalMinted = mintPromo.modalContent.totalMinted;
    // Purchase history for the modal ("big picture") — newest first, capped
    // so the promo doc can't grow unbounded.
    mintPromo.modalContent.mintHistory = [
      { date: new Date().toISOString(), quantity, status: 'claimed' as const },
      ...(mintPromo.modalContent.mintHistory || []),
    ].slice(0, 50);
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

  // First-purchase bonus, TWO rates since 2026-07-10 (Boris):
  //   - NEW players: every pass on the FIRST paid purchase = 2 spins
  //     (FIRST_PURCHASE_SPINS_PER_PASS) — buy 1 → 2, buy 2 → 4, no cap.
  //   - RETURNING players (past-player snapshot / manual allowlist / web2
  //     identity match): the CLASSIC promo, unchanged — every 2 passes = 1
  //     spin (was every-4 until 07-06).
  // One-time for everyone — the durable `firstPurchaseBonusGranted` flag
  // gates it (so retries can't double-grant). Runs in the SAME tx as the
  // mint promo above, so a single purchase advances both atomically
  // (interconnection).
  let firstPurchaseSpinsEarned = 0;
  if (opts.handleFirstPurchase && userSnap) {
    const userData = userSnap.data() as (User & { isReturningPlayer?: boolean }) | undefined;
    const isReturning = userData?.isReturningPlayer === true || isReturningWalletSync(userRef.id);
    const grant = computeFirstPurchaseGrant(!!userData?.firstPurchaseBonusGranted, quantity, isReturning);
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
  // Gated on isBuyBonusActive (enabled + before the Sunday-night endsAtMs
  // cutoff): outside the window purchases must not bank hidden progress or
  // claims toward it — that's what stranded 173 milestones before July 4th.
  const buyBonusDoc = isBuyBonusActive()
    ? promosSnap.docs.find((doc) => (doc.data() as Promo).type === 'buy-bonus')
    : undefined;
  if (buyBonusDoc) {
    const buyBonusPromo = deepClone(buyBonusDoc.data() as Promo);
    const bbMax = buyBonusPromo.progressMax || 2;
    const bbCurrent = buyBonusPromo.progressCurrent || 0;
    const bbNewTotal = bbCurrent + quantity;
    // DELTA, not absolute — same fix as computeMintProgress. Subtracting
    // Math.floor(bbCurrent / bbMax) prevents a stored `bbMax` (the full-bar
    // value on an exact-multiple landing) from re-counting the already-awarded
    // milestone and granting an extra bonus on the next purchase.
    const bbNewlyEarned = Math.floor(bbNewTotal / bbMax) - Math.floor(bbCurrent / bbMax);
    // Rolls over at the milestone (2/2 → 0/2), same as computeMintProgress —
    // the promo repeats, so a stuck full bar read as "done".
    buyBonusPromo.progressCurrent = bbNewTotal % bbMax;
    if (bbNewlyEarned > 0) {
      buyBonusPromo.claimCount = (buyBonusPromo.claimCount || 0) + bbNewlyEarned;
      recalcPromoClaimable(buyBonusPromo);
      buyBonusMilestonesEarned = bbNewlyEarned;
    }
    tx.set(buyBonusDoc.ref, stripUndefined(buyBonusPromo), { merge: true });
  }

  return { mintMilestonesEarned, buyBonusMilestonesEarned, firstPurchaseSpinsEarned, newTotalMinted };
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
    pushStreamEventBg(userId, 'promo-first-purchase', {
      awardedCount: result.firstPurchaseSpinsEarned,
    });
  }
  // Post-commit push. Fires once per actual milestone earned (Buy 10
  // can fire multiple times in a single bulk mint — e.g. quantity=20
  // earns 2 spins). awardedCount lets the toast read "earned 2 free spins".
  if (result.mintMilestonesEarned > 0) {
    pushStreamEventBg(userId, 'promo-buy-10', {
      awardedCount: result.mintMilestonesEarned,
    });
  }
  // NOTE: buy-bonus (Buy 2 → 1 Free) milestones intentionally fire NO event —
  // that promo is HIDDEN from the UI (not in VISIBLE_PROMO_TYPES; Boris
  // retired it). A noti/toast would surface a promo users can't see.
  // Always nudge the user's devices to refetch promos so the mint progress
  // box (e.g. 9/10) syncs in real-time across devices on EVERY purchase, not
  // just when a milestone is hit. (usePromos refetches on any stream ping.)
  pushStreamEventBg(userId, 'notification', { source: 'purchase' });
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
): Promise<{ referralMilestonesEarned: number; referrerUserId?: string | null; friendName?: string; friendTotal?: number; newlyHit?: string[] }> {
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

  // NEW PLAYERS ONLY (Boris 2026-07-13): a returning player pays no referral
  // rewards. track/route.ts refuses to link them up front, but a user whose
  // returning flag landed AFTER they were linked (web2 identity match runs on
  // first login) can still have an entry — remove it here (unless a reward was
  // already claimed) so the referrer never stares at eternally-"pending" rows.
  // The referrer learns via the one-time "not a new player" bell instead.
  const buyerIsReturning = (buyerUser as { isReturningPlayer?: boolean }).isReturningPlayer === true
    || isReturningWalletSync(buyerUserId);
  if (buyerIsReturning) {
    // Manual pin (Boris 2026-07-13): an entry stamped keepEvenIfReturning
    // stays visible in the history even though it can never pay (e.g.
    // RisBrian's family account). Earns nothing, isn't auto-removed.
    const pinned = (entry as { keepEvenIfReturning?: boolean }).keepEvenIfReturning === true;
    if (pinned) return { referralMilestonesEarned: 0 };
    const anythingClaimed = entry.rewards
      && Object.values(entry.rewards).some((v) => v === 'claimed');
    if (!anythingClaimed) {
      referralPromo.modalContent.referralHistory = referralPromo.modalContent.referralHistory.filter(
        (e: ReferralEntry) => e.referredUserId !== buyerUserId,
      );
      // merge:true replaces array fields wholesale, so the removal sticks.
      tx.set(referralPromoDoc.ref, stripUndefined(referralPromo), { merge: true });
    }
    return { referralMilestonesEarned: 0 };
  }

  let milestonesEarned = 0;
  const newlyHit: string[] = [];
  entry.draftsPurchased = (entry.draftsPurchased || 0) + quantity;
  // Ladder v2 (Boris 2026-06-10): 1 → 4 → 10 lifetime passes, one spin each
  // (max 3 per friend). bought4 mirrors the friend's own First-Purchase
  // milestone; bought10 mirrors Buy-10 — aligned incentives.
  if (entry.rewards && entry.rewards.bought4 === undefined) entry.rewards.bought4 = 'pending';
  const ladder: Array<{ key: 'bought1' | 'bought4' | 'bought10'; at: number }> = [
    { key: 'bought1', at: 1 },
    { key: 'bought4', at: 4 },
    { key: 'bought10', at: 10 },
  ];
  // Requirement (Boris 2026-06-11): the friend must have VERIFIED their X
  // (and claimed their own spin — that's when 'verified' flips) before any
  // mint milestone pays the referrer. Purchases still ACCUMULATE in
  // draftsPurchased — if they verify later, the verified handler re-runs
  // this ladder and the held milestones fire then (nothing is lost).
  const friendVerified = entry.rewards?.verified === 'claimed';
  for (const t of ladder) {
    if (friendVerified && entry.draftsPurchased >= t.at && entry.rewards?.[t.key] === 'pending') {
      entry.rewards[t.key] = 'claim';
      entry.status = 'claim';
      entry.milestoneDates = { ...(entry.milestoneDates || {}), [t.key]: new Date().toISOString() };
      referralPromo.claimCount = (referralPromo.claimCount || 0) + 1;
      referralPromo.claimable = true;
      milestonesEarned += 1;
      newlyHit.push(t.key);
    }
  }

  tx.set(referralPromoDoc.ref, stripUndefined(referralPromo), { merge: true });
  return {
    referralMilestonesEarned: milestonesEarned,
    referrerUserId: buyerUser.referredBy ?? null,
    // Floor placeholder/raw-wallet usernames to the canonical Banana handle (same
    // guard as cleanUsername above) so a referrer's milestone noti never reads
    // "User-0x…" or a raw wallet for a freshly-seeded buyer.
    friendName: buyerUser.username
      && !/^user-?[0-9a-fx]/i.test(buyerUser.username.trim())
      && !/^0x[0-9a-f]{6,}/i.test(buyerUser.username.trim())
      ? buyerUser.username.trim()
      // Server-assigned number from the doc in-hand — never the wallet hash.
      : (typeof buyerUser.bananaNumber === 'number'
          ? `Banana${buyerUser.bananaNumber}`
          : bananaPlaceholderName(buyerUserId)),
    friendTotal: entry.draftsPurchased,
    newlyHit,
  };
}

export async function incrementReferralPromos(
  buyerUserId: string,
  quantity: number,
): Promise<{ referralMilestonesEarned: number }> {
  if (quantity <= 0) return { referralMilestonesEarned: 0 };
  const db = getAdminFirestore();
  await ensureUserSeeded(buyerUserId);
  const userRef = db.collection(USERS_COLLECTION).doc(buyerUserId);
  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return { referralMilestonesEarned: 0 };
    const buyerUser = userSnap.data() as User;
    return _incrementReferralPromosInTx(tx, buyerUser, buyerUserId, quantity);
  });
  await notifyReferrerOfMilestones(result, quantity);
  return { referralMilestonesEarned: result.referralMilestonesEarned };
}

/** Post-commit: ring the referrer's bell the moment a milestone fires —
 *  AWAITED (a void fire-and-forget can die with the lambda). */
async function notifyReferrerOfMilestones(
  result: { referralMilestonesEarned: number; referrerUserId?: string | null; friendName?: string; friendTotal?: number; newlyHit?: string[] },
  quantity: number,
): Promise<void> {
  if (!result.referralMilestonesEarned || !result.referrerUserId) return;
  const spins = result.referralMilestonesEarned;
  try {
    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(result.referrerUserId, {
      type: 'referral',
      title: spins === 1 ? 'Free Spin to Claim!' : `${spins} Free Spins to Claim!`,
      message: `${result.friendName} — who you referred — just bought ${quantity} ${quantity === 1 ? 'pass' : 'passes'} (${result.friendTotal} total). Claim your ${spins === 1 ? 'Free Banana Spin' : 'Free Banana Spins'}.`,
      link: '/promos?promo=3',
      dedupeKey: `ref-milestones-${result.friendName}-${(result.newlyHit ?? []).join('-')}`,
      icon: 'users',
    });
  } catch { /* noti best-effort — the claim is already committed */ }
  // NOTE: do NOT also emit a generic 'referral-milestone' stream event here —
  // the createNotification above already delivers live + to the bell (naming
  // the friend). A second event produced a duplicate generic "Referral free
  // spin!" ping. One event, one ping.
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
  let _referralResultForPostCommit: { referralMilestonesEarned: number; referrerUserId?: string | null; friendName?: string; friendTotal?: number; newlyHit?: string[] } | null = null;

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
      const apiBase = (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app').trim(); // staging only — never the old prod API
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
    if (buyBonusMilestonesEarned > 0 && API_CONFIG.promos.buyBonus.reward === 'draft') {
      freeDraftsAdded = buyBonusMilestonesEarned * API_CONFIG.promos.buyBonus.bonusFreeDrafts;
    }
    // Stash for post-commit event push (inside this transaction the data
    // isn't durable yet — firing here would notify on a tx that might
    // still roll back).
    _mintMilestonesForPostCommitPush = mintMilestonesEarned;

    _referralResultForPostCommit = await _incrementReferralPromosInTx(tx, user, purchase.userId, purchase.quantity);

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
  if (_referralResultForPostCommit) {
    await notifyReferrerOfMilestones(_referralResultForPostCommit, prePurchase.quantity);
  }
  if (_mintMilestonesForPostCommitPush > 0) {
    pushStreamEventBg(prePurchase.userId, 'promo-buy-10', {
      awardedCount: _mintMilestonesForPostCommitPush,
    });
  }
  // Always nudge devices to refetch promos so mint progress (e.g. 9/10) syncs
  // in real-time on every purchase, not just at a milestone.
  pushStreamEventBg(prePurchase.userId, 'notification', { source: 'purchase' });

  // Bell: every successful pass buy gets a real-time confirmation (Boris).
  await notifyPassPurchased(prePurchase.userId, prePurchase.quantity, purchaseId);

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
  /** Raw count of `active` tokens the Go API returned, BEFORE the on-chain
   *  owner filter. 0 here = the wallet genuinely has no completed drafts
   *  (legit empty). >0 with a null return = a failure/ambiguous rebuild
   *  (Go slow, on-chain check dropped everything, rosters not ready) — the
   *  caller must NOT treat that as "no drafts". */
  rawTokenCount?: number;
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

  let active: Array<{ _cardId?: string; _leagueId?: string; roster?: Record<string, Array<{ team?: string; position?: string; playerId?: string; displayName?: string }> | undefined> }> = [];
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
    // Capture the RAW token count before the on-chain owner filter below.
    // This is the authoritative "does this wallet have any completed drafts"
    // signal — the caller uses it to tell a genuine zero (rawTokenCount===0)
    // apart from a rebuild that failed/dropped everything (rawTokenCount>0
    // but ends with totalDrafts===0).
    if (diagOut) diagOut.rawTokenCount = active.length;

    // CRITICAL: the Go `/draftToken/all` list keeps a draft under its ORIGINAL
    // drafter forever — it does NOT drop a team you sold or transferred away. So
    // without this gate, sold teams stay in your Exposure even though they're
    // gone from My Teams (which is on-chain `ownerOf`-gated). Filter to tokens
    // the wallet STILL owns on-chain. Safe-by-default: we only drop a token when
    // the chain returns a DIFFERENT valid owner; a null/errored/ambiguous read
    // (or a non-numeric staging cardId) keeps the token, so we never wrongly
    // hide a team you actually own. Matches the My-Teams ownerOf philosophy.
    const ownerChecked = await Promise.all(
      active.map(async (t) => {
        const cid = t._cardId;
        if (!cid) return t;
        let owner: string | null = null;
        try { owner = await getOnchainOwner(cid); } catch { owner = null; }
        if (owner && owner !== lower) return null; // chain says someone else owns it → sold/transferred
        return t;
      }),
    );
    active = ownerChecked.filter((t): t is (typeof active)[number] => t !== null);

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
    // Distinguish a GENUINE zero (the wallet has no completed drafts at all)
    // from a FAILED/ambiguous rebuild (the Go API returned tokens but we
    // aggregated nothing — rosters not ready, or the on-chain owner filter
    // dropped everything on a slow RPC). The endpoint shows "No draft data
    // yet" only for the former, and a "building…" retry state for the latter.
    if (diagOut) {
      diagOut.reason = (diagOut.rawTokenCount ?? 0) === 0
        ? 'genuinely-empty'
        : 'no-rosters-with-team';
    }
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
  const rawExposureName = userSnap.exists ? ((userSnap.data() as User).username || '') : (existing?.username || '');
  // Floor the seeded `User-0x…` placeholder / raw wallet to the SERVER-assigned
  // banana handle (doc in-hand) — never the wallet hash, which collides.
  const exposureNumber = userSnap.exists ? (userSnap.data() as User).bananaNumber : undefined;
  const username = rawExposureName
    && !/^user-?[0-9a-fx]/i.test(rawExposureName.trim())
    && !/^0x[0-9a-f]{6,}/i.test(rawExposureName.trim())
    ? rawExposureName.trim()
    : (typeof exposureNumber === 'number' ? `Banana${exposureNumber}` : bananaPlaceholderName(lower));

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

function emptyQueueDoc(type: 'jackpot' | 'hof' | 'jackhof'): DraftQueue {
  return { type, rounds: [], nextRoundId: 1 };
}

function newRound(roundId: number): QueueRound {
  return { roundId, members: [], status: 'filling', draftId: null };
}

export async function getQueueStatus(): Promise<Record<string, DraftQueue>> {
  const db = getAdminFirestore();
  const ids = ['jackpot', 'hof', 'jackhof'] as const;
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
  type: 'jackpot' | 'hof' | 'jackhof',
): Promise<{ queue: DraftQueue; joinedRoundIds: number[] }> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  return db.runTransaction(async (tx) => {
    const [userSnap, queueSnap] = await Promise.all([tx.get(userRef), tx.get(queueRef)]);
    const user = userSnap.data() as User;
    const queue: DraftQueue = queueSnap.exists ? (queueSnap.data() as DraftQueue) : emptyQueueDoc(type);
    if (!queue.rounds) queue.rounds = [];

    const entryField = type === 'jackpot' ? 'jackpotEntries' : type === 'hof' ? 'hofEntries' : 'jackhofEntries';
    const entries = (user as unknown as Record<string, unknown>)[entryField] as number || 0;
    if (entries <= 0) throw new ApiError(400, `No ${type} entries available`);

    // Consume entries
    tx.set(userRef, { [entryField]: 0 }, { merge: true });

    // Add new entries to next available rounds (don't touch existing rounds)
    const joinedRoundIds: number[] = [];
    for (let i = 0; i < entries; i++) {
      let round = queue.rounds.find(
        r => r.status === 'filling' && r.members.length < QUEUE_MAX && !r.members.some(m => m.wallet === userId),
      );
      if (!round) {
        round = newRound(queue.nextRoundId++);
        queue.rounds.push(round);
      }
      round.members.push({ wallet: userId, joinedAt: Date.now() });
      joinedRoundIds.push(round.roundId);

      // Note: status stays 'filling' — the caller (ensureSpecialDraftSeat)
      // creates/joins the Go league and flips status to 'drafting' at 10/10.
    }

    tx.set(queueRef, queue);
    return { queue, joinedRoundIds };
  });
}

/**
 * Queue a wheel-won JP/HOF pass by its NFT tokenId. Unlike joinQueue, this does
 * NOT consume an entries counter — the minted pass NFT IS the entry. The slot is
 * tied to `tokenId`; create-draft resolves the current on-chain owner at fill, so
 * a sale-while-filling hands the slot to the buyer. Idempotent per token.
 */
export async function joinQueueWithToken(
  userId: string,
  type: 'jackpot' | 'hof' | 'jackhof',
  tokenId: string,
): Promise<{ queue: DraftQueue; joinedRoundId: number | null }> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);

  return db.runTransaction(async (tx) => {
    const queueSnap = await tx.get(queueRef);
    const queue: DraftQueue = queueSnap.exists ? (queueSnap.data() as DraftQueue) : emptyQueueDoc(type);
    if (!queue.rounds) queue.rounds = [];

    // Idempotent: never queue the same token twice. Still report which round
    // holds it so the caller can ensure its Go league exists.
    const existing = queue.rounds.find(r => r.members.some(m => m.tokenId === tokenId));
    if (existing) return { queue, joinedRoundId: existing.roundId };

    let round = queue.rounds.find(
      r => r.status === 'filling' && r.members.length < QUEUE_MAX && !r.members.some(m => m.wallet === userId),
    );
    if (!round) {
      round = newRound(queue.nextRoundId++);
      queue.rounds.push(round);
    }
    round.members.push({ wallet: userId, joinedAt: Date.now(), tokenId });

    tx.set(queueRef, queue);
    return { queue, joinedRoundId: round.roundId };
  });
}

/**
 * Atomically decide who creates the Go league for a round. Exactly one caller
 * gets `claimed: true` and must then create the league + store its draftId
 * (updateQueueRoundDraftId clears the claim) or release via
 * clearQueueRoundCreating on failure. Everyone else either gets the existing
 * draftId or `wait: true` (someone is mid-create — poll again shortly).
 * Claims older than 60s are treated as crashed and taken over.
 */
export async function claimSpecialDraftCreation(
  type: 'jackpot' | 'hof' | 'jackhof',
  roundId: number,
): Promise<{ draftId: string | null; claimed: boolean; wait: boolean }> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) throw new ApiError(404, 'Queue not found');
    const queue = snap.data() as DraftQueue;
    const round = (queue.rounds || []).find(r => r.roundId === roundId);
    if (!round) throw new ApiError(404, `Round ${roundId} not found`);
    if (round.draftId) return { draftId: round.draftId, claimed: false, wait: false };
    const now = Date.now();
    if (round.creatingAt && now - round.creatingAt < 60_000) {
      return { draftId: null, claimed: false, wait: true };
    }
    round.creatingAt = now;
    tx.set(queueRef, queue);
    return { draftId: null, claimed: true, wait: false };
  });
}

/** Release a creation claim after a failed league create so another request can retry. */
export async function clearQueueRoundCreating(type: 'jackpot' | 'hof' | 'jackhof', roundId: number): Promise<void> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) return;
    const queue = snap.data() as DraftQueue;
    const round = (queue.rounds || []).find(r => r.roundId === roundId);
    if (!round || !round.creatingAt) return;
    round.creatingAt = null;
    tx.set(queueRef, queue);
  });
}

/**
 * Flip a round to 'drafting' the moment its league hits 10/10 — this CLOSES the
 * sell window (listing eligibility, wheel-pass browse, purchase guard and seat
 * reassign all gate on status === 'filling'). Returns the round's members so
 * the caller can cancel cached listings and notify. Idempotent: returns
 * `changed: false` if the round already left 'filling'.
 */
export async function markQueueRoundDrafting(
  type: 'jackpot' | 'hof' | 'jackhof',
  roundId: number,
): Promise<{ changed: boolean; members: Array<{ wallet: string; tokenId?: string }> }> {
  const db = getAdminFirestore();
  const queueRef = db.collection(QUEUES_COLLECTION).doc(type);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) return { changed: false, members: [] };
    const queue = snap.data() as DraftQueue;
    const round = (queue.rounds || []).find(r => r.roundId === roundId);
    if (!round) return { changed: false, members: [] };
    const members = (round.members || []).map(m => ({ wallet: m.wallet, tokenId: m.tokenId }));
    if (round.status !== 'filling') return { changed: false, members };
    round.status = 'drafting';
    tx.set(queueRef, queue);
    return { changed: true, members };
  });
}

/**
 * For each given tokenId, returns its JP/HOF level IF that token is currently in a
 * still-FILLING queue round (status 'filling', no draftId yet) — i.e. a wheel-won
 * JP/HOF pass that hasn't drafted and is therefore sellable while filling. Tokens
 * that aren't in a filling round (drafted, or never queued) are simply omitted.
 */
/**
 * Authoritative draft progress for a special (wheel) draftId, straight from the
 * Go engine. The queue round's `status`/member-count can LAG behind reality
 * (e.g. staging fill-bots seat the Go league directly without touching the
 * queue), so trusting the queue alone wrongly keeps a live draft's pass
 * "sellable". `state/info` returns a plain string until the draft initializes,
 * then JSON with currentDrafter/pickNumber once it starts. Best ball is 15
 * rounds, so total picks = seats × 15; complete once pickNumber reaches that.
 * Fail-OPEN (not started) so a flaky Go check never wrongly locks a sale.
 */
async function fetchGoDraftProgress(draftId: string): Promise<{ started: boolean; complete: boolean }> {
  if (!draftId) return { started: false, complete: false };
  const base = (
    process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
    process.env.STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
  ).trim();
  try {
    const res = await fetch(`${base}/draft/${encodeURIComponent(draftId)}/state/info`, { cache: 'no-store' });
    if (!res.ok) return { started: false, complete: false };
    const txt = await res.text();
    if (!txt || !txt.trim().startsWith('{')) return { started: false, complete: false }; // "draft state not yet initialized"
    const d = JSON.parse(txt) as { currentDrafter?: string; pickNumber?: number; draftStartTime?: number; draftOrder?: unknown[] };
    const started = !!d.currentDrafter || !!d.draftStartTime || (typeof d.pickNumber === 'number' && d.pickNumber >= 1);
    const seats = Array.isArray(d.draftOrder) && d.draftOrder.length > 0 ? d.draftOrder.length : QUEUE_MAX;
    const complete = typeof d.pickNumber === 'number' && d.pickNumber >= seats * 15;
    return { started, complete };
  } catch {
    return { started: false, complete: false };
  }
}

/** True if the special draft has actually begun drafting (incl. completed). */
export async function isSpecialDraftStarted(draftId: string): Promise<boolean> {
  return (await fetchGoDraftProgress(draftId)).started;
}

/**
 * If the token is currently seated in a special (wheel) draft that is MID-DRAFT
 * (started but not complete), returns that draftId — meaning it must NOT be
 * sold or bought (the roster is locked while drafting). Returns null otherwise:
 * an undrafted/still-filling pass sells via the wheel path, and a COMPLETED team
 * sells via the normal drafted-team path.
 */
export async function getLiveSpecialDraftLock(tokenId: string): Promise<string | null> {
  const want = String(tokenId);
  const db = getAdminFirestore();
  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    const snap = await db.collection(QUEUES_COLLECTION).doc(type).get();
    if (!snap.exists) continue;
    const queue = snap.data() as DraftQueue;
    for (const round of queue.rounds || []) {
      if (!round.draftId) continue;
      if (!(round.members || []).some((m) => String(m.tokenId) === want)) continue;
      const { started, complete } = await fetchGoDraftProgress(round.draftId);
      if (started && !complete) return round.draftId;
    }
  }
  return null;
}

export async function getFillingWheelPassLevels(
  tokenIds: string[],
): Promise<Record<string, 'jackpot' | 'hof' | 'jackhof'>> {
  const result: Record<string, 'jackpot' | 'hof' | 'jackhof'> = {};
  if (tokenIds.length === 0) return result;
  const want = new Set(tokenIds.map(String));
  const db = getAdminFirestore();

  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    const snap = await db.collection(QUEUES_COLLECTION).doc(type).get();
    if (!snap.exists) continue;
    const queue = snap.data() as DraftQueue;
    for (const round of queue.rounds || []) {
      // Sellable window = the round is still FILLING. A filling round gets its
      // Go-API draftId assigned up front (the slot follows the NFT while filling),
      // so draftId presence does NOT mean "already drafted".
      if (round.status !== 'filling') continue;
      if ((round.members || []).length >= QUEUE_MAX) continue;
      const matched = (round.members || []).filter((m) => m.tokenId && want.has(String(m.tokenId)));
      if (matched.length === 0) continue;
      // The queue `status` can lag the real draft (e.g. fill-bots), so confirm
      // with the Go engine: once the draft has actually STARTED it's no longer a
      // sellable filling lobby — drop it.
      if (round.draftId && (await isSpecialDraftStarted(round.draftId))) continue;
      for (const m of matched) result[String(m.tokenId)] = type;
    }
  }
  return result;
}

/**
 * Reassign a wheel-won pass's queue slot to a new wallet. Called when the pass
 * is bought on the marketplace while its draft is still filling: the queue still
 * records the seller, so the buyer wouldn't see the filling draft on their
 * drafting page (membership is matched by wallet). Rewrites the member.wallet for
 * the round(s) holding this tokenId to the new owner. Returns true if anything
 * changed. Only rewrites rounds that are still FILLING — once the draft starts,
 * the roster is locked and the slot shouldn't move.
 */
export interface ReassignResult {
  changed: boolean;
  /** The seller we replaced (so the caller can make them LEAVE the Go draft). */
  prevWallet: string | null;
  /** The Go draftId the seller had created (cleared here so the buyer's next
   *  entry re-runs create-draft and joins THEM to a fresh draft). */
  prevDraftId: string | null;
}

export async function reassignQueuePassWallet(tokenId: string, newWallet: string): Promise<ReassignResult> {
  const db = getAdminFirestore();
  const result: ReassignResult = { changed: false, prevWallet: null, prevDraftId: null };
  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    const ref = db.collection(QUEUES_COLLECTION).doc(type);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const queue = snap.data() as DraftQueue;
      let mutated = false;
      for (const round of queue.rounds || []) {
        if (round.status !== 'filling') continue;
        // A full round is locked even if its status hasn't flipped yet.
        if ((round.members || []).length >= QUEUE_MAX) continue;
        const member = round.members.find(m => m.tokenId && String(m.tokenId) === String(tokenId));
        if (!member || member.wallet === newWallet) continue;
        result.prevWallet = member.wallet;
        result.prevDraftId = round.draftId || null;
        member.wallet = newWallet;
        member.joinedAt = Date.now();
        // Keep the round's draftId: the lobby's foreign-slot filter + draft-room
        // gate both key off it to lock the seller out. The seller is removed from
        // the Go draft by the caller (leave), freeing the seat for the buyer.
        mutated = true;
      }
      if (mutated) { tx.set(ref, queue); result.changed = true; }
    });
  }
  return result;
}

/**
 * Update a queue round's draftId. Called when the frontend creates a Go API draft
 * for a special draft round that doesn't have one yet.
 */
export async function updateQueueRoundDraftId(
  type: 'jackpot' | 'hof' | 'jackhof',
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
    // Storing the draftId completes any in-flight creation claim.
    round.creatingAt = null;

    tx.set(queueRef, queue);
  });
}

/**
 * Update a queue round's status (e.g., to 'drafting' when draft starts).
 * Also optionally updates member count for display purposes.
 */
export async function updateQueueRoundStatus(
  type: 'jackpot' | 'hof' | 'jackhof',
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
  type: 'jackpot' | 'hof' | 'jackhof',
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

export async function resetQueue(type: 'jackpot' | 'hof' | 'jackhof'): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(QUEUES_COLLECTION).doc(type).set(emptyQueueDoc(type));
}

// ==================== DAILY-DRAFTS PROMO: DRAFT COMPLETION TRACKING ====================

const DAILY_DRAFTS_PROMO_ID = '1';
const FIRST_PURCHASE_PROMO_ID = '11';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// Dedup ledger of already-credited draftIds. Kept ACROSS cycle resets so a
// duplicate fill-event for a just-completed draft can't re-credit into the
// next cycle (the "4/4 → claim → 1/4" bug: the 4th draft's second fire landed
// in the ~½s window after the ledger was wiped). Capped so it can't grow
// unbounded — far larger than any realistic burst of duplicate fire events.
const DAILY_DEDUP_LEDGER_MAX = 50;

/**
 * Does a daily-drafts cycle need resetting (progress + timer back to 0/24:00)?
 * Single source of truth used by BOTH the read-side display normalization and
 * the write-side recordDraftCompletion, so they can never drift apart.
 *
 * Resets when EITHER:
 *   - the 24h timer has expired, OR
 *   - progress > 0 but there is NO timer (an orphaned doc left by the old
 *     delete-collision bug — would otherwise stick at "3/4 · 24:00:00").
 *
 * Deliberately NOT gated on `claimable`: unclaimed spins are separate from the
 * cycle, so a pending CLAIM must not block the cycle reset (that left users
 * stuck at "2/4 · 0:00:00 · CLAIM"). Callers reset progress + timer only and
 * leave claimable/claimCount untouched.
 */
export function dailyDraftCycleNeedsReset(
  promo: { timerEndTime?: string; progressCurrent?: number },
  now: number = Date.now(),
): boolean {
  const timerExpired = !!promo.timerEndTime && new Date(promo.timerEndTime).getTime() < now;
  const orphanedProgress = !promo.timerEndTime && (promo.progressCurrent || 0) > 0;
  return timerExpired || orphanedProgress;
}

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
    pushStreamEventBg(userId, 'first-purchase-unlocked', {});
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
 * Authoritative pass type ('free' | 'paid') for the token bound to `draftId`,
 * read from the Go API — every draft token is stamped with the pass type the
 * user actually chose at entry (DraftToken.PassType, the source of truth).
 *
 * Promos must NEVER be earned with a free draft. The client tells us the pass
 * type, but a free draft that lost its `passType` URL hint defaults to 'paid'
 * client-side and would slip past the free gate — that's the Pick-10-on-a-free-
 * draft bug. So we read the real stamp here instead of trusting the client.
 *
 * Returns `null` when it can't be determined (token not found / no stamp / API
 * error); callers then fall back to the client value (today's behavior — no
 * regression for legacy tokens), so this only ever makes the gate STRICTER.
 */
export async function resolveDraftPassType(userId: string, draftId: string): Promise<'free' | 'paid' | null> {
  if (!draftId) return null;
  const lower = userId.toLowerCase();
  const baseUrl = (
    process.env.STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
  ).replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/owner/${encodeURIComponent(lower)}/draftToken/all`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      active?: Array<Record<string, unknown>>;
      available?: Array<Record<string, unknown>>;
    };
    const all = [...(body.active ?? []), ...(body.available ?? [])];
    const tok = all.find((t) => String(t._leagueId ?? t.leagueId ?? '') === draftId);
    const pt = tok ? String(tok.passType ?? '') : '';
    if (pt === 'free') return 'free';
    if (pt === 'paid') return 'paid';
    return null; // unknown — caller falls back to the client-supplied value
  } catch {
    return null;
  }
}

/**
 * Is `userId` actually IN the draft `draftId`? Reads the draft's authoritative
 * roster `drafts/{draftId}/cards`, which the Go engine writes the moment a user
 * JOINS (models/leagues.go) — well before the draft fills and the promo fires.
 * So a real participant is always present here; a forged/unowned draftId has no
 * such roster at all. Keyed by the draftId itself, so it's independent of the
 * token's sometimes-blank `_leagueId` field.
 *
 * Returns 'in' (real participant), 'absent' (draft exists but they're not in it,
 * OR the draft doesn't exist → forged), or 'error' (read failed — never deny).
 */
async function userInDraftRoster(userId: string, draftId: string): Promise<'in' | 'absent' | 'error'> {
  if (!draftId) return 'absent';
  try {
    const snap = await getAdminFirestore().collection(`drafts/${draftId}/cards`).get();
    const want = userId.toLowerCase();
    for (const doc of snap.docs) {
      const data = doc.data() as { OwnerId?: unknown; _ownerId?: unknown };
      if (String(data.OwnerId ?? data._ownerId ?? '').toLowerCase() === want) return 'in';
    }
    return 'absent';
  } catch {
    return 'error';
  }
}

/**
 * THE shared promo-credit gate for the auto-fired draft promos (daily-drafts,
 * pick-10, jackpot). Fast path is unchanged: a stamped token decides instantly
 * with no extra read. The roster check ONLY runs when no stamp is found — the
 * ambiguous case where forged-draftId abuse lives — so the normal path adds
 * zero latency.
 *
 *   stamped 'free'           → false (free drafts never earn a promo)
 *   stamped 'paid'           → true
 *   no stamp + in roster     → honor a 'free' client hint, else credit (real
 *                              participant whose stamp was just unreadable — same
 *                              as the old fallback, so no false-deny)
 *   no stamp + NOT in roster → false (forged/unowned draftId — the abuse we close)
 *   no stamp + roster error  → fall back to client value (never deny a real user
 *                              on a read failure)
 */
export async function promoCreditAllowed(
  userId: string,
  draftId: string,
  clientPassType: string | undefined,
  promoTag: string,
): Promise<boolean> {
  const stamped = await resolveDraftPassType(userId, draftId);
  // Weekend window: FREE drafts earn promos too (participation still verified
  // below — only the free/paid discrimination is lifted, and it auto-reverts).
  if (stamped === 'free') return promoWeekendActive();
  if (stamped === 'paid') return true;
  // No pass stamp found — decide via the authoritative draft roster.
  const roster = await userInDraftRoster(userId, draftId);
  if (roster === 'in') return promoWeekendActive() || clientPassType !== 'free';
  if (roster === 'absent') {
    logger.warn(LOG_SOURCES.promo.PARTICIPATION_DENIED, { actor: userId, context: { draftId, promo: promoTag, clientClaimed: clientPassType } });
    return false;
  }
  logger.warn(LOG_SOURCES.promo.PARTICIPATION_UNVERIFIED, { actor: userId, context: { draftId, promo: promoTag, clientClaimed: clientPassType } });
  return clientPassType !== 'free';
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
  // Credit only a real PAID participant of this draft. Free drafts, forged/
  // unowned draftIds, and non-participants earn nothing (see promoCreditAllowed).
  if (!(await promoCreditAllowed(userId, draftId, passType, 'daily-drafts'))) {
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
    // Reset a stale cycle before crediting (expired timer, or orphaned progress
    // with no timer). See dailyDraftCycleNeedsReset. Resets progress + timer +
    // dedup ledger only; keeps claimable/claimCount so a pending CLAIM survives.
    if (dailyDraftCycleNeedsReset(promo)) {
      promo.progressCurrent = 0;
      promo.timerEndTime = undefined;
      promo.completedDraftIds = [];
      needsTimerDelete = true;
    }

    const prevProgress = promo.progressCurrent || 0;
    promo.progressCurrent = prevProgress + 1;
    promo.completedDraftIds = [...(promo.completedDraftIds || []), draftId].slice(-DAILY_DEDUP_LEDGER_MAX);

    if (prevProgress === 0) {
      promo.timerEndTime = new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString();
      // We just set a fresh timer for the new cycle. Clear the delete flag so
      // the write below can't wipe it (THE bug: an expiry-reset set the flag,
      // then this fresh timer got deleted, leaving a cycle with no timer).
      needsTimerDelete = false;
    }

    // Target reached: 3/4 → (4th draft) → 0/4 with CLAIM button + 24:00:00.
    let justBecameClaimable = false;
    if (promo.progressCurrent >= (promo.progressMax || 4)) {
      promo.progressCurrent = 0;
      promo.claimable = true;
      promo.claimCount = (promo.claimCount || 0) + 1;
      // Cumulative all-time counter for the modal stats ("spins earned from
      // this promo") — claimCount drains on claim, this never decrements.
      promo.modalContent.totalDailyClaims = (promo.modalContent.totalDailyClaims || 0) + 1;
      // History entry per completed 4-set ("big picture" list in the modal).
      promo.modalContent.dailyHistory = [
        { date: new Date().toISOString(), count: 4 },
        ...(promo.modalContent.dailyHistory || []),
      ].slice(0, 50);
      promo.timerEndTime = undefined;
      // Do NOT clear completedDraftIds here. Wiping the dedup ledger at the
      // instant the cycle completes is exactly what let a duplicate fill-event
      // for THIS draft re-credit into the next cycle (4/4 → claim → phantom
      // 1/4). Keep the ledger (capped above) so the same draftId can never be
      // counted twice. It clears legitimately on genuine 24h expiry below.
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
      pushStreamEventBg(userId, 'promo-daily-drafts', { draftId });
    }
    return promo;
  });
}

// ==================== PICK-10 PROMO: RECORD WHEN USER GETS PICK #10 ====================

const PICK10_PROMO_ID = '2';

/**
 * Best-effort heads-up to a slot-10 drafter that their Pick-10 spin did NOT
 * apply because the draft was a Founder Draft (the Pick-10 spin doesn't stack
 * on top of the Founder reward spin every paid participant already gets).
 * Deduped per (draft, user) so the multiple Pick-10 credit paths — and the
 * live gate in /api/promos/pick10 — can't double-notify. Shared by the
 * chokepoint guard below and that route. Never throws.
 */
export async function notifyPick10FounderSkip(userId: string, draftId: string): Promise<void> {
  try {
    await createNotification(userId.toLowerCase(), {
      type: 'founder_draft',
      title: 'Pick 10 — Founder Draft',
      message: "You landed Pick 10! In a Founder Draft the Pick 10 spin doesn't stack — you already earned a Free Banana Spin from the Founder reward. 🍌",
      link: '/banana-wheel',
      dedupeKey: `pick10-founder-skip-${draftId}-${userId.toLowerCase()}`,
      icon: 'spin',
    });
  } catch { /* notification is best-effort — never block the credit path */ }
}

export async function recordPick10(userId: string, draftId: string, draftName: string, passType?: string, slot = 10): Promise<Promo | null> {
  // Free-pass drafts earn NO promo credit — only paid drafts count toward
  // Pick 10. The draft token is stamped with the chosen pass type (source of
  // truth) — use it, falling back to the client value only when the stamp can't
  // be read, so a free draft can never sneak past as paid (the slot-10 bug).
  // Credit only a real PAID participant of this draft (see promoCreditAllowed).
  if (!(await promoCreditAllowed(userId, draftId, passType, 'pick-10'))) return null;
  // Founder Drafts: the Pick-10 spin does NOT stack on top of the Founder Draft
  // reward spin (granted to every paid participant in lib/founderGrant.ts), so
  // suppress it and tell the drafter why. isFounderDraftMarked reads the
  // persistent founderDrafts doc, which is written at fill — reliably present by
  // the time the durable credit paths run (reveal-complete + draft-close
  // backstop). The earlier client path races the marking and is gated live in
  // /api/promos/pick10. Idempotent + deduped (the notification dedupe-keys on
  // draft+user), so re-fires across paths are harmless.
  if (await isFounderDraftMarked(draftId)) {
    void notifyPick10FounderSkip(userId, draftId);
    return null;
  }
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

    // Already recorded this draft → no-op, no event push. Legacy entries
    // stored the raw draftId in draftName; new ones carry draftId separately.
    if (history.some(h => (h as { draftId?: string }).draftId === draftId || h.draftName === draftId)) {
      return { promo, justAdded: false };
    }

    history.unshift({
      // Full ISO — the modal shows real date AND time (Boris 2026-06-10).
      date: new Date().toISOString(),
      draftId,
      // Human name ("BBB #1374") when the caller has it; raw id as fallback.
      draftName: draftName && draftName !== draftId ? draftName : draftId,
      status: 'claim' as const,
      // Which draft slot earned it (10 normally; 6 or 9 during the expanded
      // window after a batch's specials are all hit).
      slot,
    } as (typeof history)[number]);
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
      pushStreamEventBg(userId, 'promo-pick-10', { draftId, slot });
    }
    return promo;
  });
}

/**
 * True when the CURRENT 100-draft batch has had ALL its specials hit — the 1
 * Jackpot AND all 5 HOF designated drafts for this batch have filled. Mirrors
 * the per-100 distribution math in the Go API (models/leagues.go
 * ReturnBatchProgress) and the batchProgress SSE route (1 JP + 5 HOF per 100).
 *
 * Used to EXPAND the Pick-10 promo: while this is true, the promo also rewards
 * draft slots 6 and 9 (not just slot 10). It flips back to false automatically
 * when the next batch starts (FilledLeaguesCount crosses the next multiple of
 * 100 and the specials reset), so the promo reverts to slot-10-only.
 */
interface BatchSpecialsState {
  /** True when this batch's 1 Jackpot + 5 HOF have all filled. */
  allHit: boolean;
  /** True once the rolling-lane era is active for this view — the pick-slot
   *  LADDER is retired then (pinned to base) and copy drops ladder language. */
  rolling?: boolean;
  /** Filled-count index where the current 100-batch began (the dedupe key for
   *  the "promo just expanded" announcement — one announcement per batch). */
  batchStart: number;
  filled: number;
  /** True when this batch's Jackpot has filled (HOFs may remain) — unlocks
   *  the middle Pick-6&10 tier (Boris 2026-07-03 ladder design). */
  jpHit: boolean;
}

async function getBatchSpecialsState(opts?: { display?: boolean }): Promise<BatchSpecialsState> {
  const db = getAdminFirestore();
  const snap = await db.collection('drafts').doc('draftTracker').get();
  if (!snap.exists) return { allHit: false, jpHit: false, batchStart: 0, filled: 0 };
  const d = snap.data() as Record<string, unknown>;
  const filled = Number(d.FilledLeaguesCount ?? 0) || 0;
  if (filled <= 0) return { allHit: false, jpHit: false, batchStart: 0, filled };
  // ROLLING-LANE ERA: the Pick-slot LADDER is retired (Boris 2026-07-20 —
  // rolling windows kill the dead-window problem the ladder existed to fight).
  // Pin both views to the base tier once rolling is active:
  //   • CREDIT view pins from RollingStartDraft (draft 200's own reveal still
  //     pays its legacy batch's earned 6/9/10 tier).
  //   • DISPLAY view pins from RollingStartDraft-1 (card shows base "Pick 10"
  //     the moment the last legacy draft fills).
  // jpHit:false also silences announcePick10ExpansionIfActivated permanently.
  const rollingStart = Number(d.RollingStartDraft ?? 0);
  if (rollingStart > 0 && filled >= (opts?.display ? rollingStart - 1 : rollingStart)) {
    return { allHit: false, jpHit: false, batchStart: filled, filled, rolling: true };
  }
  const jpIds = Array.isArray(d.JackpotLeagueIds) ? (d.JackpotLeagueIds as number[]) : [];
  const hofIds = Array.isArray(d.HofLeagueIds) ? (d.HofLeagueIds as number[]) : [];
  const current = filled % 100;
  let batchStart = filled - current;
  if (current === 0 && filled > 0) {
    // At a batch boundary (e.g. FilledLeaguesCount=100 — the batch's last draft
    // just filled) the two views diverge (Boris 2026-07-08):
    //   • CREDIT view (default): stay on the just-completed batch, so league
    //     100's OWN reveal still awards its batch's Pick 6/9/10 tier.
    //   • DISPLAY view: advance to the NEXT batch, so the promo card + dashboard
    //     show the fresh "Pick 10 / 1 JP / 5 HOF" the moment the batch closes,
    //     not the spent all-hit state. Deductions begin as the new batch fills.
    batchStart = opts?.display ? filled : filled - 100;
  }
  const hitInBatch = (ids: number[]) => ids.filter((id) => id > batchStart && id <= filled).length;
  const jackpotRemaining = Math.max(0, 1 - hitInBatch(jpIds));
  const hofRemaining = Math.max(0, 5 - hitInBatch(hofIds));
  const jpHit = jackpotRemaining === 0;
  return { allHit: jpHit && hofRemaining === 0, jpHit, batchStart, filled };
}

export async function allBatchSpecialsHit(): Promise<boolean> {
  return (await getBatchSpecialsState()).allHit;
}

/**
 * The Pick-slot promo LADDER (Boris 2026-07-03) — the reward escalates as the
 * batch's chase prizes run out, so there's always a reason to draft NOW:
 *   • Jackpot still hiding → slot 10 only (the JP itself is the promo).
 *   • Jackpot hit, HOFs remain → slots 6 & 10.
 *   • Everything hit (JP + all 5 HOF) → slots 6, 9 & 10.
 * Resets automatically when the next 100-batch starts (fresh JP → slot 10).
 * Paid drafts only — enforced downstream in recordPick10/promoCreditAllowed.
 */
export async function getPick10ActiveSlots(): Promise<{ slots: number[]; tier: 'base' | 'jp' | 'all'; batchStart: number }> {
  const state = await getBatchSpecialsState();
  if (state.allHit) return { slots: [6, 9, 10], tier: 'all', batchStart: state.batchStart };
  if (state.jpHit) return { slots: [6, 10], tier: 'jp', batchStart: state.batchStart };
  return { slots: [10], tier: 'base', batchStart: state.batchStart };
}

/**
 * DISPLAY-ONLY tier for the promo CARD (Boris 2026-07-08). Identical to
 * getPick10ActiveSlots EXCEPT at a batch boundary: the moment the batch's last
 * draft fills (FilledLeaguesCount hits a multiple of 100), this shows the NEXT
 * batch's fresh tier — base = "Pick 10" — so the card doesn't confuse people by
 * still advertising "Pick 6, 9 & 10" after the batch has ended. It NEVER touches
 * crediting: getPick10ActiveSlots (above) is what reveal-complete/refresh-draft
 * use to actually award spins, and it stays on the just-completed batch so league
 * 100's own reveal still pays out its earned Pick 6/9/10.
 */
export async function getPick10DisplayTier(): Promise<{ slots: number[]; tier: 'base' | 'jp' | 'all'; batchStart: number; rolling: boolean }> {
  const state = await getBatchSpecialsState({ display: true });
  const rolling = state.rolling === true;
  if (state.allHit) return { slots: [6, 9, 10], tier: 'all', batchStart: state.batchStart, rolling };
  if (state.jpHit) return { slots: [6, 10], tier: 'jp', batchStart: state.batchStart, rolling };
  return { slots: [10], tier: 'base', batchStart: state.batchStart, rolling };
}

// Bound the bell fan-out so a misread tracker can never broadcast to an
// unbounded user set. Comfortably above the live staging/early-prod userbase.
const PICK10_EXPANSION_MAX_FANOUT = 10000;

/**
 * Announce — ONCE per 100-batch — that the Pick-10 promo just EXPANDED to also
 * reward draft slots 6 and 9 (because this batch's specials — 1 Jackpot + 5
 * HOF — are now all hit). The expansion reverts when the next batch starts, so
 * this is timely "draft now" messaging. Sends an in-app bell to every account
 * plus a single OneSignal push for users who are off-site.
 *
 * Idempotent at the BATCH level via a create-once guard doc keyed by the
 * batch's start index: the first draft-completion that observes the fully-hit
 * batch wins and broadcasts; every later completion in the same batch (the
 * other watching reveal clients + the close backstop) no-ops. Best-effort —
 * never throws into the promo-credit path that calls it.
 */
export async function announcePick10ExpansionIfActivated(): Promise<void> {
  try {
    const { allHit, jpHit, batchStart } = await getBatchSpecialsState();
    if (!jpHit) return;

    // Two-tier ladder announcements, each ONCE per batch:
    //   jp  → "Pick 6 & 10 unlocked" the moment the batch's Jackpot hits.
    //   all → "Pick 6, 9 & 10" when every special is gone.
    // A batch where JP hits last announces the jp tier and then the all tier
    // moments later — two distinct messages, each with its own guard + dedupe.
    const tier = allHit ? 'all' : 'jp';
    const guardId = tier === 'all' ? `pick10-expansion-${batchStart}` : `pick10-expansion-jp-${batchStart}`;

    const db = getAdminFirestore();
    // Create-once guard: .create() throws ALREADY_EXISTS if a prior observer of
    // this same batch already announced, so exactly one broadcast goes out.
    const guardRef = db.collection('promo_announcements').doc(guardId);
    try {
      await guardRef.create({
        kind: tier === 'all' ? 'pick10-expansion' : 'pick10-expansion-jp',
        batchStart,
        announcedAt: FieldValue.serverTimestamp(),
      });
    } catch {
      return; // already announced this tier for this batch
    }

    const title = tier === 'all'
      ? 'New Promo — Pick 6, 9 & 10 Free Spins'
      : 'New Promo — Pick 6 & 10 Free Spins';
    const message = tier === 'all'
      ? 'Every special is hit (the Jackpot + all 5 HOF) — so Pick 6, 9 AND 10 now each win a Free Spin, until the next batch begins!'
      : 'The Jackpot has been hit — so Pick 6 and Pick 10 now each win a Free Spin, until the batch ends!';
    const link = '/promos';
    // Batch+tier-scoped dedupeKey → each user gets exactly one bell per tier.
    const dedupeKey = guardId;

    // In-app bell → every account EXCEPT first-season users who haven't
    // drafted yet (Boris 2026-07-03): a brand-new user's early sessions
    // shouldn't include batch-promo bells — they discover the promo via the
    // NEW-ribbon card, and start receiving this bell from their first draft
    // onward. RETURNING players always receive it (they know the product).
    const draftedSnap = await db
      .collection('v2_activity_events')
      .where('type', '==', 'draft_entered')
      .select('userId')
      .limit(20000)
      .get();
    const hasDrafted = new Set(draftedSnap.docs.map((d) => String((d.data() as { userId?: string }).userId ?? '')));
    const { isReturningWalletSync } = await import('@/lib/returningUsers');
    const usersSnap = await db
      .collection(USERS_COLLECTION)
      .select('isReturningPlayer')
      .limit(PICK10_EXPANSION_MAX_FANOUT)
      .get();
    const wallets = usersSnap.docs
      .filter((doc) => {
        const w = doc.id.toLowerCase();
        const returning = (doc.data() as { isReturningPlayer?: boolean }).isReturningPlayer === true
          || isReturningWalletSync(w);
        return returning || hasDrafted.has(w);
      })
      .map((doc) => doc.id);
    const { createNotificationForWallets } = await import('@/lib/queueNotifications');
    const bells = await createNotificationForWallets(wallets, {
      type: 'promo',
      title,
      message,
      link,
      dedupeKey,
      // Clean line icon (same wheel icon as spin-won bells) — never emoji.
      icon: 'spin',
    });

    // Push → all opted-in devices, one OneSignal API call (off-site users).
    const { sendBroadcastPushToAll } = await import('@/lib/notifications/broadcast');
    const push = await sendBroadcastPushToAll({ title, body: message, url: link });

    logger.info('promo.pick10_expansion.announced', {
      batchStart, candidates: wallets.length, bells, push: push.status, pushRecipients: push.recipients,
    });
  } catch (err) {
    // Best-effort: an announcement failure must never break promo crediting.
    logger.error('promo.pick10_expansion.failed', { err: err instanceof Error ? err : String(err) });
  }
}

// ==================== JACKPOT-HIT PROMO: RECORD WHEN USER LANDS IN A JACKPOT DRAFT ====================

const JACKPOT_HIT_PROMO_ID = '4';
const BATCH_SIZE = 100;

/**
 * Bonus tiers for the jackpot promo:
 *   • slot 1–25  → 10 spins (early-batch hit)
 *   • slot 26–50 → 5 spins
 *   • slot 51–100 → 0 spins — NO bonus spin draw (Boris 2026-06-30). The jackpot
 *     draft still functions (league winner → finals); only the bonus spins are
 *     gated to the first 50 of each batch. awardJackpotDraw skips the entire draw
 *     when this returns 0 (no winner, no credit, no bells, no receipt).
 * `position` is 1-indexed within the current batch (1..100).
 */
function jackpotSpinReward(position: number): number {
  if (position >= 1 && position <= 25) return 10;
  if (position >= 26 && position <= 50) return 5;
  return 0;
}

// (Legacy jackpotWinnerIndex + getDraftWinnerOwner helpers removed 2026-06-24 —
// they only fed the retired recordJackpotHit path. The VRF draw winner is now
// derived in awardJackpotDraw via deriveDrawWinnerIdx over the PAID list.)

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
    const d = snap.data() as {
      FilledLeaguesCount?: number;
      RollingStartDraft?: number;
      JackpotLeagueIds?: number[];
    } | undefined;
    const filled = Number(d?.FilledLeaguesCount ?? 0);
    if (filled <= 0) return 1;
    // ROLLING-LANE ERA (draft >= RollingStartDraft): "position" becomes the
    // hit's 1-indexed spot within the JP lane's OWN window, replayed from the
    // id array the same way lib/rollingLanes.ts does. The tracker already
    // contains this hit (id == filled), so replay only the EARLIER hits to
    // find the window this one landed in. Tiers (1-25 → 10 spins, 26-50 → 5)
    // carry over unchanged, now window-relative (Boris 2026-07-20).
    const rollingStart = Number(d?.RollingStartDraft ?? 0);
    if (rollingStart > 0 && filled >= rollingStart) {
      const priorHits = (Array.isArray(d?.JackpotLeagueIds) ? d.JackpotLeagueIds : [])
        .filter((id) => Number(id) >= rollingStart && Number(id) < filled);
      const { replayJpLane } = await import('@/lib/rollingLanes');
      const windowStart = replayJpLane(priorHits, rollingStart, filled).windowStart;
      const pos = filled - windowStart + 1;
      return pos >= 1 && pos <= 100 ? pos : 1;
    }
    // Legacy fixed-batch era: 1-indexed position within the aligned batch.
    return ((filled - 1) % BATCH_SIZE) + 1;
  } catch {
    return 1;
  }
}

/**
 * Jackpot draw v2 (Boris 2026-06-10) — the ONE award path for a revealed
 * Jackpot draft. Called once per draft (reveal-complete + close backstop);
 * the jackpot_draws/{draftId} create() makes every re-run a no-op.
 *
 *  • Winner drawn among PAID entrants ONLY (slot order), index =
 *    sha256('jp-draw:' + draftId) mod paidCount — committed before the type
 *    was known, so neither side can steer it. (Seed basis recorded for the
 *    provably-fair display; upgradeable to the merkle-round VRF seed.)
 *  • Reward by cycle position (1-25 → 10, 26-50 → 5, else 1 spin).
 *  • Winner: promo credit + "You won N Free Spins" bell.
 *  • Other drafters: ONE noti each — combined with the Jackpot Club badge
 *    copy when the badge just unlocked, draw-only otherwise (badge unlock
 *    runs silent here so nobody gets two pings).
 */
export async function awardJackpotDraw(draftId: string, displayName?: string): Promise<{ winnerWallet: string | null; reward: number } | null> {
  const db = getAdminFirestore();

  // Idempotency gate FIRST.
  const drawRef = db.collection('jackpot_draws').doc(draftId);
  try {
    await drawRef.create({ draftId, pending: true, atIso: new Date().toISOString() });
  } catch {
    const existing = await drawRef.get();
    const d = existing.data() ?? {};
    return { winnerWallet: (d.winnerWallet as string) ?? null, reward: Number(d.reward ?? 0) };
  }

  // Slot order from the Go API (public draft order).
  let order: string[] = [];
  try {
    const baseUrl = (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/draft/${encodeURIComponent(draftId)}/state/info`);
    if (res.ok) {
      const data = (await res.json()) as { draftOrder?: { ownerId?: string }[]; displayName?: string };
      order = (data.draftOrder ?? []).map((o) => (o.ownerId ?? '').toLowerCase()).filter(Boolean);
      if (!displayName && data.displayName) displayName = data.displayName;
    }
  } catch { /* falls through to empty order */ }
  const humans = order.filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  if (humans.length === 0) {
    await drawRef.set({ pending: false, noOrder: true }, { merge: true });
    return null;
  }

  // Paid entrants only — authoritative token stamp per wallet. During the
  // weekend promo window FREE entrants are eligible too (auto-reverts).
  const paid: string[] = [];
  for (const w of humans) {
    const t = await resolveDraftPassType(w, draftId).catch(() => null);
    if (t === 'paid' || (t === 'free' && promoWeekendActive())) paid.push(w);
  }

  const position = await getCurrentBatchPosition();
  const reward = jackpotSpinReward(position);

  // Slots 51–100 of the batch award NO bonus spins (Boris 2026-06-30). Skip the
  // spin draw entirely: no winner pick, no spin credit, NO bells, no on-chain
  // draw receipt. Paid entrants KEEP the Jackpot Club badge (they were in a
  // jackpot draft) — unlocked silently, no bell. The idempotency record is left
  // `pending:true` (set by create() above) + flagged `noSpinDraw`, so every draw
  // consumer (promo card "latest draw", proof feed, reveal modal, ensureDraw-
  // Receipt) skips it — they all require `pending===false`. The jackpot draft
  // itself is untouched; only the bonus-spin promo is gated to the first 50.
  if (reward === 0) {
    for (const w of paid) {
      await unlockBadge(w, 'jackpot-club', { source: 'jackpot-draw', draftId }, { silent: true }).catch(() => {});
    }
    await drawRef.set({ noSpinDraw: true, reward: 0, position }, { merge: true });
    logger.info('promo.jackpot_draw.no_spins', { context: { draftId, position, paidCount: paid.length } });
    return null;
  }

  const filledCount = await (async () => {
    try {
      const snap = await db.collection('drafts').doc('draftTracker').get();
      return Number((snap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0);
    } catch { return 0; }
  })();

  // Winner from the wheel period's SEALED seed (salt + VRF randomness locked
  // on-chain before this draft existed) bound to this draft's paid list —
  // unpredictable pre-fill, fully recomputable at period reveal. Legacy
  // draftId-only basis is the fallback so a draw never blocks on period state.
  const { getSealedDrawSeed, deriveDrawWinnerIdx, sealedSeedBasis, postDrawReceiptOnchain } =
    await import('@/lib/jackpotDrawProof');
  const sealed = await getSealedDrawSeed();
  let winnerWallet: string | null = null;
  let winnerIdx: number | null = null;
  if (paid.length > 0) {
    winnerIdx = sealed
      ? deriveDrawWinnerIdx(sealed, draftId, paid.length)
      : crypto.createHash('sha256').update(`jp-draw:${draftId}`).digest().readUInt32BE(0) % paid.length;
    winnerWallet = paid[winnerIdx];
  }

  // Display names for the draw animation + notis.
  const { getPublicUsers } = await import('@/lib/friends');
  const nameMap = await getPublicUsers(humans).catch(() => new Map());
  const nameOf = (w: string) => (nameMap.get(w)?.username as string | undefined) || bananaPlaceholderName(w);

  const atIso = new Date().toISOString();
  await drawRef.set({
    pending: false,
    draftId,
    displayName: displayName ?? draftId,
    winnerWallet,
    winnerName: winnerWallet ? nameOf(winnerWallet) : null,
    winnerIdx,
    // slot = the entrant's REAL position in the draft order (1-based), so the
    // draw animation shows the same slot numbers people saw in the room.
    eligible: paid.map((w, i) => ({ wallet: w, name: nameOf(w), idx: i, slot: order.indexOf(w) + 1 })),
    participants: humans.length,
    reward,
    position,
    filledCount,
    atIso,
    vrfPeriod: sealed?.periodNumber ?? null,
    saltHash: sealed?.saltHash ?? null,
    seedBasis: sealed
      ? sealedSeedBasis(sealed)
      : 'sha256("jp-draw:" + draftId) → uint32 % paidCount, paid entrants in slot order',
  }, { merge: true });

  // INSTANT on-chain receipt — the full draw record lands on Base within
  // seconds. Never blocks the draw; close backstop retries via ensureDrawReceipt.
  const receiptTxHash = await postDrawReceiptOnchain({
    draftId,
    displayName: displayName ?? draftId,
    periodNumber: sealed?.periodNumber ?? null,
    saltHash: sealed?.saltHash ?? null,
    paid,
    winnerWallet,
    winnerIdx,
    reward,
    atIso,
  });
  if (receiptTxHash) await drawRef.set({ receiptTxHash }, { merge: true });

  // Credit the winner's jackpot promo (history + claimable spins).
  if (winnerWallet) {
    await creditJackpotWinnerPromo(winnerWallet, draftId, displayName ?? draftId, reward).catch(() => {});
  }

  const { createNotification } = await import('@/lib/queueNotifications');
  // PAID entrants only. The spin draw, the draw bell, the "watch the draw"
  // video link AND the Jackpot Club badge all go to the paid drafters who were
  // actually in the draw — free-pass seats earn nothing from the jackpot promo
  // (Boris 2026-06-24). winnerWallet is always a member of `paid`, so the winner
  // is always included.
  for (const w of paid) {
    const isWinner = w === winnerWallet;
    // Badge unlock SILENT here — we send the one combined/draw noti below.
    const newlyBadged = await unlockBadge(w, 'jackpot-club', { source: 'jackpot-draw', draftId }, { silent: true }).catch(() => false);
    if (isWinner) {
      await createNotification(w, {
        type: 'jackpot',
        title: `You Won ${reward} Free Spins!`,
        message: `The ${reward}-Spin Draw from your Jackpot draft landed on YOU — up to ${reward * 20} free drafts. Claim your spins.${newlyBadged ? ' Jackpot Club badge unlocked.' : ''}`,
        link: `/promos?promo=4&draw=${encodeURIComponent(draftId)}`,
        dedupeKey: `jp-draw-win-${draftId}`,
        icon: 'sparkles',
      }).catch(() => {});
    } else {
      await createNotification(w, {
        type: 'jackpot',
        title: newlyBadged ? 'JACKPOT! Badge Unlocked + Draw Live' : `The ${reward}-Spin Draw Is Live`,
        message: newlyBadged
          ? `You're in a Jackpot draft — Jackpot Club badge unlocked, and the ${reward}-Spin Draw just ran. Watch the draw.`
          : `Your Jackpot draft triggered the ${reward}-Spin Draw. Watch the draw.`,
        link: `/promos?promo=4&draw=${encodeURIComponent(draftId)}`,
        dedupeKey: `jp-draw-${draftId}`,
        icon: 'sparkles',
      }).catch(() => {});
    }
  }
  logger.info('promo.jackpot_draw.awarded', { context: { draftId, winnerWallet, reward, position, paidCount: paid.length } });
  return { winnerWallet, reward };
}

/** Credit the drawn winner's Jackpot promo: history entry + claimable spins.
 *  Idempotent per draft (history dedupe). Used by awardJackpotDraw. */
async function creditJackpotWinnerPromo(userId: string, draftId: string, displayName: string, reward: number): Promise<void> {
  const db = getAdminFirestore();
  await ensureUserSeeded(userId);
  const promoRef = db.collection(USERS_COLLECTION).doc(userId).collection(PROMOS_SUBCOLLECTION).doc(JACKPOT_HIT_PROMO_ID);
  await db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(promoRef);
    if (!promoSnap.exists) return;
    const promo = deepClone(promoSnap.data() as Promo);
    if (promo.type !== 'jackpot') return;
    const history = promo.modalContent.jackpotHistory || [];
    if (history.some(h => h.draftName === draftId || h.draftName === displayName)) return;
    history.unshift({ date: new Date().toISOString(), draftName: displayName || draftId, amount: reward });
    promo.modalContent.jackpotHistory = history;
    promo.progressCurrent = 1;
    promo.claimable = true;
    promo.claimCount = (promo.claimCount || 0) + reward;
    (promo as unknown as Record<string, unknown>).updatedAt = new Date().toISOString();
    tx.set(promoRef, stripUndefined(promo), { merge: true });
  });
  // Live refetch ONLY (no bell). This pushes the just-credited spins to the
  // winner's open session in real time so their claimable count updates without
  // a reload. The winner's single bell — "You Won N Free Spins!" — is sent by
  // awardJackpotDraw; firing 'promo-jackpot-hit' here too would persist a
  // duplicate "Jackpot Hit!" bell (Boris 2026-06-24).
  pushStreamEventBg(userId, 'notification', { source: 'jackpot-draw-credit' });
}

export async function recordJackpotHit(_userId: string, _draftId: string, _passType?: string): Promise<Promo | null> {
  // RETIRED 2026-06-24 — no-op. The Jackpot Hit promo is now credited
  // EXCLUSIVELY by the VRF draw path `awardJackpotDraw` (paid-only winner draw,
  // on-chain receipt, single "You Won N Free Spins!" bell, real-time credit).
  // This legacy per-drafter path picked the winner with a DIFFERENT algorithm
  // (sha256(draftId) % 10 over ALL seats, paid or free) and wrote history under
  // a DIFFERENT dedupe key, so running it alongside the draw could credit a
  // SECOND winner — or double-credit the same one. Neutered to a hard no-op so
  // the now-vestigial /api/promos/jackpot-hit route (and any stale clients still
  // POSTing to it during a deploy) can never double-award.
  return null;
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

  // On a genuinely new unlock, surface it two ways. `silent` skips both
  // (ripeness/club tiers can opt out — no notification spam).
  if (wasNewlyUnlocked && !opts?.silent) {
    // BELL — write it EXPLICITLY and AWAITED here. The `badge-unlock` stream
    // event below ALSO attempts a best-effort dual-write bell, but that runs
    // fire-and-forget in a nested waitUntil chain that can freeze right after
    // the fast RTDB toast push lands — so the toast appeared but the bell was
    // silently dropped ("ripe toast, no bell"). createNotification is
    // idempotent on `dedupeKey` (badge-<id> → .create() ALREADY_EXISTS no-op),
    // so this never double-bells with the stream dual-write; it just guarantees
    // the durable record exists. It also fires its own real-time 'notification'
    // ping, so the bell shows up live on every device.
    const badge = BADGE_BY_ID[badgeId];
    if (badge) {
      // Show the ACTUAL count they hit, not the badge's hover-range. Ripeness
      // unlocks pass the real `paidCount` (computeAndStoreRipeness) — so the bell
      // reads "19 paid drafts completed this season" instead of "10–19 paid
      // drafts" (the range is just info for how to earn it, per Boris). Badges
      // without a count fall back to the badge's description.
      const paidCount = typeof source?.paidCount === 'number' ? (source.paidCount as number) : null;
      const message = paidCount !== null
        ? `${paidCount} paid draft${paidCount === 1 ? '' : 's'} completed this season.`
        : badge.description;
      try {
        await createNotification(userId, {
          type: 'promo',
          title: `Badge unlocked: ${badge.label}`,
          message,
          link: '/profile?tab=badges',
          dedupeKey: `badge-${badgeId}`,
          icon: 'award',
        });
      } catch { /* best-effort */ }
    }
    // TOAST — fast RTDB push to the user's event stream (real-time, transient).
    pushStreamEventBg(userId, 'badge-unlock', {
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
 * Sync a user's banana ripeness from their PAID-drafts-FILLED count (caller
 * supplies it — paid tokens bound to a league via the Go API; see
 * countPaidDraftsFilled / fetchOwnerPaidFilledCount in lib/api/owner.ts. A
 * token only gets its leagueId when the draft hits 10/10, so taking a seat in
 * a filling draft counts for nothing until the draft really fills).
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
  // Unlock the earned tier badges — INCLUDING the first Unripe banana, which is
  // now earned at 1 paid draft (not handed out at 0). Not silent: ripening into
  // a new tier (the very first banana included) fires a bell + toast.
  for (const id of unlockedRipenessIds(paidCount)) {
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
    let next = typeof counterData?.next === 'number' ? counterData.next : BANANA_NUMBER_START;
    // Skip numbers whose "Banana{n}" is already someone's STORED username —
    // ~189 pre-guard accounts carry their old hash default as a real
    // (reserved) name, and an assigned handle must never read identical to
    // another user's username. New Banana#### claims are blocked
    // (lib/usernames), so the squatted set is fixed and each number is only
    // ever walked past once.
    for (let guard = 0; guard < 50; guard++) {
      const [resSnap, dupeSnap] = await Promise.all([
        tx.get(db.collection('usernames').doc(`banana${next}`)),
        tx.get(db.collection(USERS_COLLECTION).where('username_lower', '==', `banana${next}`).limit(1)),
      ]);
      if (!resSnap.exists && dupeSnap.empty) break;
      next++;
    }
    tx.set(counterRef, { next: next + 1 }, { merge: true });
    tx.set(userRef, { bananaNumber: next }, { merge: true });
    return next;
  });
}

/**
 * Directory presence for a HOUSE BOT (Boris 2026-07-21): every bot appears in
 * All Users like a real member. Creates the v2_users doc (firstLoginAt makes
 * it roster-eligible), allocates the same sequential Banana#### any user gets,
 * stores it as the bot's username, and claims the usernames reservation so
 * the number can never be double-assigned. Idempotent — safe on every mint.
 */
export async function seedBotUserIdentity(wallet: string): Promise<void> {
  const db = getAdminFirestore();
  const w = wallet.toLowerCase();
  const ref = db.collection(USERS_COLLECTION).doc(w);
  const snap = await ref.get();
  const nowIso = new Date().toISOString();
  if (!snap.exists) {
    await ref.set({
      id: w,
      walletAddress: w,
      ripeness: { color: '#4e9a2f', tier: 0, count: 0, range: '1–9', label: 'Unripe' },
      draftPasses: 0, freeDrafts: 0, wheelSpins: 0, jackpotEntries: 0, hofEntries: 0,
      cardPurchaseCount: 0, usdcBalance: 0, cardFeeCreditCents: 0,
      createdAt: nowIso, firstLoginAt: nowIso, lastSeenAt: nowIso,
    }, { merge: true });
  }
  const existingName = snap.exists ? ((snap.data() as User).username || '') : '';
  if (existingName && !/^user-0x/i.test(existingName)) return; // already properly named
  const n = await assignBananaNumber(w);
  const name = `Banana${n}`;
  await ref.set({ username: name, username_lower: name.toLowerCase() }, { merge: true });
  await db.collection('usernames').doc(name.toLowerCase()).set({
    walletAddress: w, name, updatedAt: Date.now(),
  }, { merge: true }).catch(() => {});
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
    // Null out any non-real name so every caller's `username || …banana` fallback
    // works: the raw wallet, the seeded `User-0x…` placeholder (createUser), or
    // any raw 0x… form. Without this the marketplace/profile showed "User-0xc0d1".
    const username = u
      && u.toLowerCase() !== id
      && !/^user-0x[0-9a-f]/i.test(u)
      && !/^0x[0-9a-f]{6,}/i.test(u)
      ? u : null;
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

/**
 * Heal-on-read: persist a legacy Go-API pfp into v2_users so future
 * display-batch reads hit the fast/reliable Firestore source instead of the
 * flaky Go API `/owner/{wallet}` call. Only ever called for wallets that had NO
 * v2_users.profilePicture (display-batch's fallback condition). Safe to write
 * unconditionally: profile EDITS now also mirror the pfp into v2_users (see
 * /api/user/metadata), and every edit updates the Go API too, so the Go value
 * is never staler than v2 — healing it in is idempotent for current users and
 * a one-time backfill for legacy ones. No frozen-avatar risk.
 *
 * merge:true never disturbs other fields. A partial doc (pfp but no username)
 * is fine: ensureUserSeeded keys on `username`, not doc existence, so the user
 * is still fully seeded on their first real login (same as the badges/activity
 * co-located merge-writers). Fire-and-forget at the call site — a failed heal
 * just means the next load re-tries the Go API, never a broken response.
 */
export async function healUserPfpFromLegacy(userId: string, profilePicture: string): Promise<void> {
  const pfp = (profilePicture || '').trim();
  if (!pfp) return;
  const db = getAdminFirestore();
  await db.collection(USERS_COLLECTION).doc(userId.toLowerCase()).set(
    { profilePicture: pfp },
    { merge: true },
  );
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

/**
 * Reverse a cumulative-withdrawals increment when a withdrawal is denied.
 * Without this, denied requests permanently inflate the user's running
 * total and trip the $2k tier-2 KYC gate for money that never moved.
 * Clamped at 0.
 */
export async function decrementCumulativeWithdrawals(userId: string, amount: number): Promise<number> {
  const db = getAdminFirestore();
  const ref = db.collection(PERSONA_COLLECTION).doc(userId);
  const doc = await ref.get();
  const current = doc.exists ? (doc.data() as PersonaVerificationData).cumulativeWithdrawals || 0 : 0;
  const newTotal = Math.max(0, current - amount);
  await ref.set({ cumulativeWithdrawals: newTotal }, { merge: true });
  return newTotal;
}
