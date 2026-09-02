// Promo codes — the "BANANA" launch (Richard 2026-09-01): a NEW player who
// enters the code while the campaign is live gets `spins` Banana Wheel spins
// from the new-user promo instead of the standing 1 (4 spins = at least 4 Free
// Drafts = "$100 in Drafts"). Every spin still pays at least 1 Free Draft.
//
// SWITCH = Firestore `system_config/promoCode` (no deploy to launch):
//   { enabled: true, code: 'BANANA', spins: 4, startsAtMs, endsAtMs }
// Flip with scripts/_promo-code-banana.mjs --on (stamps now → now+48h).
// Ships dark: while disabled every surface renders nothing and redeem 404s.
//
// Eligibility (judged inside the redeem transaction):
//   • account exists, not a returning player (flag or past-players list)
//   • has never bought (firstPurchaseBonusGranted !== true)
//   • no code on this account or any same-person linked wallet
// Order-independent: redeem before the X verify claim → the claim pays
// `spins`; redeem after the 1-spin claim → the extra (spins-1) land right now.

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { samePersonWallets } from '@/lib/linkedWallets';
import { createNotification } from '@/lib/queueNotifications';

export const PROMO_CODE_CONFIG_DOC = 'promoCode';
const USERS = 'v2_users';
const REDEMPTIONS = 'promo_code_redemptions';
const CONFIG_TTL_MS = 30_000;

export interface PromoCodeConfig {
  enabled: boolean;
  code: string;
  spins: number;
  startsAtMs: number;
  endsAtMs: number;
}

export interface UserPromoCode {
  code: string;
  spins: number;
  redeemedAt: string;
  /** True once the spins have actually been credited (at claim, or instantly). */
  granted: boolean;
  grantedAt?: string;
  /** 'claim' = paid by the new-user claim; 'instant' = extra spins credited on redeem. */
  mode?: 'claim' | 'instant';
}

let cache: { at: number; cfg: PromoCodeConfig } | null = null;

function defaults(): PromoCodeConfig {
  return { enabled: false, code: 'BANANA', spins: 4, startsAtMs: 0, endsAtMs: 0 };
}

export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Pure: live iff enabled and now inside [startsAtMs, endsAtMs). */
export function isPromoCodeActive(cfg: PromoCodeConfig, now: number = Date.now()): boolean {
  return cfg.enabled && cfg.spins >= 1 && now >= cfg.startsAtMs && now < cfg.endsAtMs;
}

export async function readPromoCodeConfig(opts: { fresh?: boolean } = {}): Promise<PromoCodeConfig> {
  const now = Date.now();
  if (!opts.fresh && cache && now - cache.at < CONFIG_TTL_MS) return cache.cfg;
  const cfg = defaults();
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('system_config').doc(PROMO_CODE_CONFIG_DOC).get();
      const d = (snap.exists ? snap.data() : null) as Partial<PromoCodeConfig> | null;
      if (d) {
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (typeof d.code === 'string' && normalizeCode(d.code)) cfg.code = normalizeCode(d.code);
        if (Number.isFinite(d.spins) && (d.spins as number) >= 1) cfg.spins = Math.floor(d.spins as number);
        if (Number.isFinite(d.startsAtMs)) cfg.startsAtMs = Number(d.startsAtMs);
        if (Number.isFinite(d.endsAtMs)) cfg.endsAtMs = Number(d.endsAtMs);
      }
    } catch (err) {
      logger.warn('promo_code.config_read_failed', { err: (err as Error).message });
    }
  }
  cache = { at: now, cfg };
  return cfg;
}

export interface PromoCodeStatus {
  active: boolean;
  endsAtMs?: number;
  spins?: number;
  /** Per-wallet (only when a wallet was given). */
  redeemed?: boolean;
  granted?: boolean;
  eligible?: boolean;
}

/** What a surface may render. NEVER returns the code itself. */
export async function getPromoCodeStatus(wallet?: string): Promise<PromoCodeStatus> {
  const cfg = await readPromoCodeConfig();
  if (!isPromoCodeActive(cfg)) {
    // A user who redeemed in time keeps seeing their applied state after the window.
    if (wallet && /^0x[0-9a-f]{40}$/.test(wallet) && isFirestoreConfigured()) {
      const snap = await getAdminFirestore().collection(USERS).doc(wallet).get();
      const pc = (snap.data() as { promoCode?: UserPromoCode } | undefined)?.promoCode;
      if (pc) return { active: false, redeemed: true, granted: pc.granted === true, spins: pc.spins, eligible: false };
    }
    return { active: false };
  }
  const base: PromoCodeStatus = { active: true, endsAtMs: cfg.endsAtMs, spins: cfg.spins };
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet) || !isFirestoreConfigured()) return base;
  const snap = await getAdminFirestore().collection(USERS).doc(wallet).get();
  const u = (snap.data() ?? {}) as { promoCode?: UserPromoCode; firstPurchaseBonusGranted?: boolean; isReturningPlayer?: boolean };
  const redeemed = !!u.promoCode;
  const returning = u.isReturningPlayer === true || isReturningWalletSync(wallet);
  const eligible = !redeemed && !returning && u.firstPurchaseBonusGranted !== true && snap.exists;
  return { ...base, redeemed, granted: u.promoCode?.granted === true, eligible };
}

export interface RedeemResult {
  spins: number;
  /** Spins credited to the wheel right now (already-verified users). */
  spinsNow: number;
  /** Spins the X verify claim will pay (unverified users). */
  spinsOnClaim: number;
}

export async function redeemPromoCode(userIdRaw: string, codeRaw: unknown): Promise<RedeemResult> {
  const userId = String(userIdRaw ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(userId)) throw new ApiError(400, 'Invalid wallet');
  const cfg = await readPromoCodeConfig();
  if (!isPromoCodeActive(cfg)) throw new ApiError(404, 'No promo code is active right now');
  const code = normalizeCode(codeRaw);
  if (!code) throw new ApiError(400, 'Enter a code');
  if (code !== cfg.code) throw new ApiError(400, 'That code is not valid');

  const db = getAdminFirestore();
  const userRef = db.collection(USERS).doc(userId);
  const linked = (await samePersonWallets(userId)).filter((w) => w !== userId);
  const twitterSnap = await db.collection('v2_twitter_links').where('walletAddress', '==', userId).limit(1).get();
  const alreadyClaimedNewUser = !twitterSnap.empty && twitterSnap.docs[0].data().newUserPromoClaimed === true;

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, ...linkedSnaps] = await Promise.all([
      tx.get(userRef),
      ...linked.map((w) => tx.get(db.collection(USERS).doc(w))),
    ]);
    if (!userSnap.exists) throw new ApiError(404, 'Create your account first, then enter the code');
    const u = userSnap.data() as {
      promoCode?: UserPromoCode; firstPurchaseBonusGranted?: boolean; isReturningPlayer?: boolean;
      newUserPromoForced?: boolean; wheelSpins?: number; username?: string;
    };
    if (u.promoCode) throw new ApiError(400, 'A promo code is already applied to this account');
    const returning = (u.isReturningPlayer === true || isReturningWalletSync(userId)) && u.newUserPromoForced !== true;
    if (returning) throw new ApiError(403, 'This code is for new players only');
    if (u.firstPurchaseBonusGranted === true) throw new ApiError(403, 'This code is for new players only');
    for (const s of linkedSnaps) {
      if ((s.data() as { promoCode?: UserPromoCode } | undefined)?.promoCode) {
        throw new ApiError(400, 'A promo code was already applied on a linked account');
      }
    }
    const nowIso = new Date().toISOString();
    // Already verified + claimed the 1-spin new-user bonus → top up now.
    const spinsNow = alreadyClaimedNewUser ? Math.max(0, cfg.spins - 1) : 0;
    const spinsOnClaim = alreadyClaimedNewUser ? 0 : cfg.spins;
    const pc: UserPromoCode = {
      code, spins: cfg.spins, redeemedAt: nowIso,
      granted: alreadyClaimedNewUser,
      ...(alreadyClaimedNewUser ? { grantedAt: nowIso, mode: 'instant' as const } : { mode: 'claim' as const }),
    };
    tx.set(userRef, {
      promoCode: pc,
      ...(spinsNow > 0 ? { wheelSpins: Math.max(0, u.wheelSpins ?? 0) + spinsNow } : {}),
    }, { merge: true });
    tx.set(db.collection(REDEMPTIONS).doc(userId), {
      userId, code, spins: cfg.spins, spinsNow, spinsOnClaim, mode: pc.mode,
      username: u.username ?? null, redeemedAt: nowIso, createdAt: FieldValue.serverTimestamp(),
    });
    if (spinsNow > 0) {
      tx.set(db.collection('v2_activity_events').doc(), {
        type: 'promo_claimed', userId, walletAddress: userId, username: u.username ?? null,
        walletType: 'privy', paymentMethod: null, quantity: spinsNow, tokenIds: [], txHash: null,
        metadata: { promoType: 'promo-code', source: 'promo-code', code, spinsAdded: spinsNow },
        devicePlatform: 'unknown', userAgent: null,
        createdAt: FieldValue.serverTimestamp(), createdAtIso: nowIso,
      });
    }
    return { spins: cfg.spins, spinsNow, spinsOnClaim } as RedeemResult;
  });

  logger.info('promo_code.redeemed', { userId, code, ...result });
  try {
    await createNotification(userId, {
      type: 'promo',
      title: result.spinsNow > 0
        ? `Code ${code} applied: ${result.spinsNow} more Free Spins 🍌`
        : `Code ${code} applied: ${result.spins} Free Spins 🍌`,
      message: result.spinsNow > 0
        ? `${result.spinsNow} Free Spins were added to your Banana Wheel. Every spin pays at least 1 Free Draft.`
        : `Verify with X on the New Player card and your Free Spin becomes ${result.spins} Free Spins. Every spin pays at least 1 Free Draft.`,
      link: result.spinsNow > 0 ? '/banana-wheel' : '/promos',
      dedupeKey: `promo-code-${code.toLowerCase()}-${userId}`,
      icon: 'gift',
    });
  } catch (err) {
    logger.warn('promo_code.bell_failed', { userId, err: (err as Error).message });
  }
  return result;
}
