import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateNonce, generateSeed, pickWeighted } from '@/lib/rng';
import { wheelSegments } from '@/lib/wheelConfig';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { addActivityEventToTx, buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { isWheelJpHofPassEnabled } from '@/lib/featureFlags';
import {
  PROMO_SPINS_FIELD,
  PURCHASE_SPINS_FIELD,
  bonusDraftsFor,
  nextSpinSource,
  type SpinSource,
} from '@/lib/spinTypes';
import { recountFromInventory } from '@/lib/passLedger';
import { unlockBadge } from '@/lib/db';
import { claimSpinIndex, getCurrentPeriod, periodSegments } from '@/lib/wheelPeriod';
import { deriveSpinOutcome } from '@/lib/wheelMerkle';
import { writeJournalEntryTx } from '@/lib/wheelAssignmentJournal';

const WHEEL_SPINS_SUBCOLLECTION = 'wheelSpins';
const USERS_COLLECTION = 'v2_users';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

const jwksCache: {
  keys: Map<string, crypto.KeyObject>;
  cachedAt: number;
} = {
  keys: new Map(),
  cachedAt: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function getPrivyAppId(): string {
  const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  if (!appId) throw new ApiError(500, 'Privy app ID not configured');
  return appId;
}

async function getPrivyVerificationKey(kid: string): Promise<crypto.KeyObject> {
  const cacheExpired = jwksCache.cachedAt === 0 || (Date.now() - jwksCache.cachedAt) > JWKS_CACHE_TTL_MS;
  const cached = !cacheExpired ? jwksCache.keys.get(kid) : undefined;
  if (cached) return cached;
  await refreshPrivyVerificationKeys();
  const key = jwksCache.keys.get(kid);
  if (!key) throw new ApiError(401, 'Unknown signing key');
  return key;
}

async function refreshPrivyVerificationKeys(): Promise<void> {
  const appId = getPrivyAppId();
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!res.ok) {
    logger.error(LOG_SOURCES.auth.JWKS_FETCH_FAILED, {
      route: '/api/wheel/spin',
      appId,
      status: res.status,
    });
    throw new ApiError(500, 'Failed to fetch Privy JWKS');
  }
  const jwks = await res.json() as { keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }> };

  jwksCache.keys = new Map();
  for (const jwk of jwks.keys) {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    jwksCache.keys.set(jwk.kid, key);
  }
  jwksCache.cachedAt = Date.now();
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Buffer;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'Invalid auth token');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart).toString('utf8')) as Record<string, unknown>;
  const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8')) as Record<string, unknown>;
  const signature = base64UrlDecode(signaturePart);
  return { header, payload, signature, signingInput: `${headerPart}.${payloadPart}` };
}

async function verifyPrivyJwt(token: string): Promise<string> {
  const appId = getPrivyAppId();

  const { header, payload, signature, signingInput } = decodeJwt(token);
  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!alg || !['ES256', 'RS256'].includes(alg)) throw new ApiError(401, 'Unsupported token algorithm: ' + alg);

  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) throw new ApiError(401, 'Missing key ID in token header');

  const verifySignature = async (forceRefresh: boolean): Promise<boolean> => {
    const key = forceRefresh
      ? (await refreshPrivyVerificationKeys(), jwksCache.keys.get(kid))
      : await getPrivyVerificationKey(kid);

    if (!key) throw new ApiError(401, 'Unknown signing key');

    const verifier = crypto.createVerify('SHA256');
    verifier.update(signingInput);
    verifier.end();

    return verifier.verify(
      alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
      signature,
    );
  };

  let isValid = false;
  try {
    isValid = await verifySignature(false);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
  }

  if (!isValid) {
    isValid = await verifySignature(true);
  }

  if (!isValid) {
    logger.error(LOG_SOURCES.auth.JWT_SIGNATURE_INVALID, {
      route: '/api/wheel/spin',
      alg,
      kid,
    });
    throw new ApiError(401, 'Token signature verification failed');
  }

  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) {
    throw new ApiError(401, 'Auth token expired');
  }

  const aud = payload.aud;
  if (aud == null) throw new ApiError(401, 'Invalid auth token');
  const audienceMatches = Array.isArray(aud) ? aud.includes(appId) : aud === appId;
  if (!audienceMatches) throw new ApiError(401, 'Invalid auth token');

  const expectedIssuer = process.env.PRIVY_JWT_ISSUER?.trim();
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new ApiError(401, 'Invalid auth token');
  }

  const userId =
    (typeof payload.sub === 'string' && payload.sub) ||
    (typeof (payload as Record<string, unknown>).user_id === 'string' && (payload as Record<string, string>).user_id) ||
    (typeof (payload as Record<string, unknown>).userId === 'string' && (payload as Record<string, string>).userId);

  if (!userId) throw new ApiError(401, 'Invalid auth token');
  return userId;
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) throw new ApiError(401, 'Missing authorization token');

    // Verify JWT is valid (proves user is authenticated)
    // Note: Privy JWT sub is a DID (did:privy:xxx), not a wallet address.
    // The body userId is the wallet address used as our app's user ID.
    // We verify the JWT is valid but use the body userId for data lookups.
    await verifyPrivyJwt(token);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) throw new ApiError(400, 'Missing userId');

    const db = getAdminFirestore();

    const seed = generateSeed();
    const nonce = generateNonce();

    // forceWheel is ADMIN-ONLY: it bypasses the VRF period and mints real
    // prizes, so only allowlisted wallets may use it. The old env-sniffing
    // gate (VERCEL_URL contains 'banana-fantasy') was effectively always-on
    // for this project — any user who knew the URL param could force a jackpot.
    const { isWalletAdmin } = await import('@/lib/adminAllowlist');
    const allowForcedResult = isWalletAdmin(userId) || process.env.NODE_ENV === 'development';
    const forceResult =
      allowForcedResult && typeof body.forceResult === 'string' ? body.forceResult : null;

    // If a VRF + Merkle period is currently active, claim a spin index inside
    // the same transaction that decrements `wheelSpins`. The outcome is
    // deterministically derived from the period's (salt, vrf, spinIndex) so
    // the user gets the result already locked in by the on-chain Merkle root.
    // Forced results bypass the period (staging-only override). Periods are
    // optional during rollout — if none exists, we fall back to legacy RNG so
    // the wheel keeps working until the admin opens period 1.
    const currentPeriod = forceResult ? null : await getCurrentPeriod();
    const usePeriod = currentPeriod && currentPeriod.status === 'active' && currentPeriod.spinCount < currentPeriod.maxSpins;

    // Prize table: the ACTIVE period's committed segmentsSnapshot (what its
    // Merkle root was derived from), falling back to the static config only
    // outside a period. Never the deployed static config while a period is
    // live — a newer config generation must not diverge from the commitment.
    const segments = usePeriod ? periodSegments(currentPeriod!) : wheelSegments;
    const segmentAngle = 360 / segments.length;
    let segment: typeof segments[number];
    let index: number;
    // For the VRF-period path: the segment we derived BEFORE the tx, so the tx's
    // atomic claim can assert it landed on the same outcome (concurrent-spin guard).
    let peekedSegmentId: string | null = null;
    let periodNumber: number | null = null;
    let spinIndexInPeriod: number | null = null;

    if (forceResult) {
      const forcedIdx = segments.findIndex(s => s.id === forceResult);
      if (forcedIdx >= 0) {
        segment = segments[forcedIdx];
        index = forcedIdx;
      } else {
        ({ value: segment, index } = pickWeighted(
          segments.map((s) => ({ value: s, probability: s.probability })),
          seed,
        ));
      }
    } else if (!usePeriod) {
      // Legacy fallback — period not yet bootstrapped or already exhausted.
      ({ value: segment, index } = pickWeighted(
        segments.map((s) => ({ value: s, probability: s.probability })),
        seed,
      ));
    } else {
      // Period path: derive the REAL deterministic outcome NOW. deriveSpinOutcome
      // is pure (salt + vrf + spinIndex → segment), so the prize, the wheel's
      // landing angle, the free-draft credit, the on-chain mint, AND the activity
      // feed below are all built from the ACTUAL result — not a "1 Draft"
      // placeholder (the bug that made every period spin pay 1 Draft). The
      // transaction below atomically CLAIMS this same spinIndex and re-derives
      // the identical outcome; it asserts they match (rare concurrent-spin guard).
      if (!currentPeriod!.salt || !currentPeriod!.vrfRandomness) {
        throw new ApiError(500, `Wheel period ${currentPeriod!.periodNumber} missing salt/vrf`);
      }
      const peek = deriveSpinOutcome(currentPeriod!.salt, currentPeriod!.vrfRandomness, currentPeriod!.spinCount, segments);
      segment = peek.segment;
      index = peek.segmentIndex;
      peekedSegmentId = peek.segment.id;
    }

    const segmentCenter = index * segmentAngle + segmentAngle / 2;
    const angle = (360 - segmentCenter + 360) % 360;
    const spinId = crypto.randomUUID();

    const prize = {
      type: segment.prizeType,
      value: segment.prizeValue,
    };
    const timestamp = nowIso();

    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const spinRef = userRef.collection(WHEEL_SPINS_SUBCOLLECTION).doc(spinId);

    // Which stack this spin comes out of decides what it pays. Promo spins pay
    // the wedge in full; purchase spins pay wedge-minus-one because the buyer
    // already owns the first draft. Resolved pre-tx because the prize, the
    // activity doc and the mint decision below are all built from the credited
    // amount — the transaction re-reads the counters and asserts the same
    // source is still available (same fail-safe as the spin-index claim).
    const preSpinSnap = await userRef.get();
    const preSpinData = preSpinSnap.data();
    const spinSource: SpinSource =
      nextSpinSource(
        Math.max(0, (preSpinData?.[PROMO_SPINS_FIELD] as number | undefined) ?? 0),
        Math.max(0, (preSpinData?.[PURCHASE_SPINS_FIELD] as number | undefined) ?? 0),
      ) ?? 'promo';

    const wedgeDrafts =
      segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number'
        ? segment.prizeValue
        : 0;
    const draftPassCount = bonusDraftsFor(spinSource, wedgeDrafts);
    const mintOnChain = isAdminMintConfigured() && draftPassCount > 0;

    // A Jackpot/HOF wheel win. When the feature flag is ON we mint a REAL pass
    // NFT for it (marked JP/HOF + wheel-origin) so the prize is a sellable asset,
    // instead of only bumping the wallet-keyed queue counter. Flag OFF → legacy
    // counter/queue path is untouched.
    const jphofKind: 'jackpot' | 'hof' | 'jackhof' | null =
      segment.prizeType === 'custom' && segment.prizeValue === 'jackpot' ? 'jackpot'
      : segment.prizeType === 'custom' && segment.prizeValue === 'hof' ? 'hof'
      : segment.prizeType === 'custom' && segment.prizeValue === 'jackhof' ? 'jackhof'
      : null;
    const mintJpHof = isWheelJpHofPassEnabled() && isAdminMintConfigured() && jphofKind !== null;

    // Pre-build the spin_won activity doc OUTSIDE the transaction (Firestore
    // forbids new reads after writes inside a transaction). On-chain mint
    // tx hash + tokenIds aren't known yet — they get populated by a
    // follow-up update event after the mint succeeds, so the spin event is
    // recorded atomically with the counter mutation regardless of mint fate.
    const spinActivityDoc = await buildActivityEventDoc({
      type: 'spin_won',
      userId,
      paymentMethod: 'free',
      quantity: draftPassCount,
      metadata: {
        spinId,
        prizeType: segment.prizeType,
        prizeValue: segment.prizeValue,
        segmentId: segment.id,
        segmentLabel: segment.label,
        mintOnChain,
      },
    });

    await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      const userData = userDoc.data();
      const promoLeft = Math.max(0, (userData?.[PROMO_SPINS_FIELD] as number | undefined) ?? 0);
      const purchaseLeft = Math.max(0, (userData?.[PURCHASE_SPINS_FIELD] as number | undefined) ?? 0);
      const txSpinSource = nextSpinSource(promoLeft, purchaseLeft);
      if (txSpinSource === null) {
        throw new ApiError(429, 'No spins remaining');
      }
      // The pre-tx read decided what this spin pays. If a concurrent grant or
      // spin changed which stack is next, the credited amount above is stale —
      // roll back rather than pay the wrong number.
      if (txSpinSource !== spinSource) {
        throw new ApiError(409, 'Spin balance changed — please spin again.');
      }

      // Period-aware path: atomically claim the next index in the active
      // period and derive the deterministic outcome. Done inside the same
      // tx as the user-balance decrement so concurrent spins can't double-
      // claim an index. Forced/legacy paths skip this and use the segment
      // chosen above.
      if (usePeriod && currentPeriod) {
        const claim = await claimSpinIndex(currentPeriod.periodNumber, tx);
        // The pre-tx peek built prize/angle/free-drafts/mint/activity from this
        // exact outcome. The atomic claim MUST land on the same one. A mismatch
        // means a concurrent spin took this index first → fail safe: throw so the
        // whole tx rolls back (no spin consumed, no wrong award) and the user
        // re-spins. On staging this effectively never happens (one spinner).
        if (peekedSegmentId !== null && claim.segmentId !== peekedSegmentId) {
          throw new ApiError(409, 'Spin slot was just taken — please spin again.');
        }
        spinIndexInPeriod = claim.spinIndex;
        periodNumber = currentPeriod.periodNumber;
        const found = segments.find((s) => s.id === claim.segmentId);
        if (!found) {
          throw new ApiError(500, `Period derived segmentId=${claim.segmentId} not present in current wheel config`);
        }
        segment = found;
        index = segments.findIndex((s) => s.id === claim.segmentId);

        // Provably-fair assignment commitment: append "wallet → spinIndex"
        // to the journal in the same tx as the claim, so the on-chain
        // batch commit (cron, every 100 spins) can never miss an entry
        // or include a wallet that didn't actually spin. Zero added on-
        // chain latency here — just one Firestore write.
        writeJournalEntryTx(tx, {
          periodNumber: currentPeriod.periodNumber,
          spinIndex: claim.spinIndex,
          wallet: userId,
        });
      }

      tx.set(spinRef, {
        userId,
        spinId,
        result: segment.id,
        prize,
        timestamp,
        seed,
        nonce,
        periodNumber,
        spinIndexInPeriod,
        // `prize.value` stays the WEDGE the wheel landed on (that's the provable
        // outcome). `bonusDrafts` is what was actually credited — they differ by
        // one on purchase spins. History and result copy read these, never the
        // wedge alone, or a 5-Draft hit reads as "5 free drafts" when 4 landed.
        spinSource,
        bonusDrafts: draftPassCount,
      });

      // Atomic counter update with floor-of-0 on every counter so legacy
      // bad data can't cascade. Spin decrement, optional pass / entry
      // increments — all in one transaction.
      const currentFree = Math.max(0, (userData?.freeDrafts as number | undefined) ?? 0);
      const currentJp = Math.max(0, (userData?.jackpotEntries as number | undefined) ?? 0);
      const currentHof = Math.max(0, (userData?.hofEntries as number | undefined) ?? 0);

      const balanceUpdate: Record<string, number | boolean> = {
        // Decrement the stack this spin actually came out of.
        [spinSource === 'purchase' ? PURCHASE_SPINS_FIELD : PROMO_SPINS_FIELD]:
          Math.max(0, (spinSource === 'purchase' ? purchaseLeft : promoLeft) - 1),
        // Mark that the user has now spun at least once — hides the first-time
        // "what's a spin?" explainer on promo cards going forward.
        hasSpunWheel: true,
      };
      // Tally every wheel winning (free drafts + jackpot/HOF entries) the user
      // must still FINISH before we surface the first-purchase promo popup.
      let winningsWon = 0;
      if (draftPassCount > 0) {
        balanceUpdate.freeDrafts = currentFree + draftPassCount;
        winningsWon += draftPassCount;
      }
      // When minting a real JP/HOF pass (flag ON), the NFT is the entry — don't
      // also bump the wallet-keyed counter (that's the legacy queue path). The
      // win still counts toward the first-purchase promo gate (winningsWon).
      if (jphofKind === 'jackpot') {
        if (!mintJpHof) balanceUpdate.jackpotEntries = currentJp + 1;
        winningsWon += 1;
      } else if (jphofKind === 'hof') {
        if (!mintJpHof) balanceUpdate.hofEntries = currentHof + 1;
        winningsWon += 1;
      } else if (jphofKind === 'jackhof') {
        const currentJackhof = Math.max(0, (userData?.jackhofEntries as number | undefined) ?? 0);
        if (!mintJpHof) balanceUpdate.jackhofEntries = currentJackhof + 1;
        winningsWon += 1;
      }
      // First-purchase popup gate counter. Only matters pre-purchase — skip
      // once they've bought or already unlocked it. Decremented as each won
      // draft completes (recordDraftCompletion → the winnings gate).
      if (winningsWon > 0 && !userData?.firstPurchaseBonusGranted && !userData?.firstPurchasePromoUnlocked) {
        const currentPending = Math.max(0, (userData?.pendingWheelWinnings as number | undefined) ?? 0);
        balanceUpdate.pendingWheelWinnings = currentPending + winningsWon;
      }
      tx.set(userRef, balanceUpdate, { merge: true });

      // Activity event in the SAME transaction — counter and feed always
      // agree about whether the spin happened.
      addActivityEventToTx(tx, spinActivityDoc);
    });

    // Everything below runs AFTER the response is sent. The Firestore tx
    // above already credited freeDrafts/jackpotEntries/hofEntries — the
    // user has their prize. The on-chain mint just delivers the NFT, and
    // the frontend polls via refreshBalanceUntil to catch up. Awaiting
    // any of this inline made the wheel wait ~10s before spinning.
    waitUntil((async () => {
      // NOTE: the win's bell notification is NOT fired here. The wheel page
      // pushes it client-side at the exact moment the wheel stops
      // (app/banana-wheel/page.tsx onSpinComplete → pushNotification →
      // server-persisted + cross-device ping) — server-firing it here either
      // spoils the reveal (too early) or lags it (delay guessing), and doing
      // both double-notified. One source, perfect timing.

      // Club badge for a Jackpot/HOF wheel WIN — participation/achievement badge
      // (Boris 2026-07-01): winning a JP/HOF draft pass on the wheel unlocks the
      // matching club, same as being in a JP/HOF draft. `unlockBadge` (not
      // silent) fires its own "Badge unlocked" bell + toast; idempotent, so it
      // never double-bells and is safe alongside the later queue-draft-filled
      // unlock. This is a SEPARATE celebratory bell from the win reveal (which
      // the wheel page still fires client-side), so it doesn't spoil the spin.
      if (jphofKind === 'jackpot') {
        await unlockBadge(userId, 'jackpot-club', { source: 'wheel-jackpot', spinId }).catch(() => {});
      } else if (jphofKind === 'hof') {
        await unlockBadge(userId, 'hof-club', { source: 'wheel-hof', spinId }).catch(() => {});
      } else if (jphofKind === 'jackhof') {
        // JackHOF = both perks on one draft → both club badges.
        await unlockBadge(userId, 'jackpot-club', { source: 'wheel-jackhof', spinId }).catch(() => {});
        await unlockBadge(userId, 'hof-club', { source: 'wheel-jackhof', spinId }).catch(() => {});
      }

      let mintTxHash: string | undefined;
      let mintedTokenIds: string[] = [];

      if (mintOnChain) {
        try {
          const res = await reserveTokensToWallet({ to: userId, count: draftPassCount });
          mintTxHash = res.txHash;
          mintedTokenIds = res.tokenIds;
          await recordPassOrigins({
            tokenIds: mintedTokenIds,
            origin: 'spin_reward',
            ownerAtMint: userId,
            txHash: mintTxHash,
            reason: `wheel_spin:${spinId}`,
          });
          // Register into the Go engine as REAL spendable free tokens, typed
          // `free`. Collision-proof on the engine side. The freeDrafts counter
          // is recounted from inventory below, so it ends up reflecting what
          // actually registered rather than the optimistic spin-tx credit.
          try {
            await registerMintedTokens(userId, mintedTokenIds, 'free');
          } catch (e) {
            logger.warn('wheel.spin.register_go_api_failed', { spinId, userId, err: (e as Error).message });
          }
          logger.info('wheel.spin.mint_ok', { spinId, userId, count: draftPassCount, txHash: mintTxHash, tokenIds: mintedTokenIds });
        } catch (mintErr) {
          logger.error('wheel.spin.mint_failed', { spinId, userId, count: draftPassCount, err: mintErr });
          try {
            await db.collection('failed_mints').doc(spinId).set({
              spinId,
              userId,
              count: draftPassCount,
              reason: `wheel_spin:${spinId}`,
              error: (mintErr as Error)?.message ?? String(mintErr),
              createdAt: FieldValue.serverTimestamp(),
              retryable: true,
            });
          } catch (logErr) {
            logger.error('wheel.spin.failed_mint_record_error', { spinId, err: logErr });
          }
        }
      }

      // JP/HOF wheel win → mint ONE real pass NFT, marked with its known level so
      // the marketplace can treat it as a JP/HOF pass before any league reveal.
      // Flag-gated; the legacy counter/queue path runs instead when OFF.
      if (mintJpHof && jphofKind) {
        try {
          const res = await reserveTokensToWallet({ to: userId, count: 1 });
          await recordPassOrigins({
            tokenIds: res.tokenIds,
            origin: 'spin_reward',
            ownerAtMint: userId,
            txHash: res.txHash,
            reason: `wheel_spin:${spinId}`,
            level: jphofKind,
          });
          try {
            await registerMintedTokens(userId, res.tokenIds, 'free');
          } catch (e) {
            logger.warn('wheel.spin.jphof_register_go_api_failed', { spinId, userId, err: (e as Error).message });
          }
          // Stamp the special LEVEL on the spendable-pool doc so this wheel pass
          // is LOCKED to its own special draft: the Go engine's selectTokensByType
          // and our countSpendableTokens both skip HOF/Jackpot-level tokens, so it
          // can never be spent to enter a regular fast/slow main-lobby draft (the
          // bug that let a HOF wheel pass be drafted into a normal league). It
          // stays sellable while the round is filling. A fresh wheel mint never
          // collides, so the validDraftTokens doc id is the on-chain tokenId.
          try {
            const specialLevel = jphofKind === 'jackpot' ? 'Jackpot' : jphofKind === 'hof' ? 'Hall of Fame' : 'JackHOF';
            await Promise.all(
              res.tokenIds.map((tid) =>
                db
                  .collection('owners').doc(userId.toLowerCase())
                  .collection('validDraftTokens').doc(String(tid))
                  .set({ Level: specialLevel }, { merge: true }),
              ),
            );
          } catch (e) {
            logger.warn('wheel.spin.jphof_level_stamp_failed', { spinId, userId, kind: jphofKind, err: (e as Error).message });
          }
          // Queue the pass by its tokenId so it enters a filling JP/HOF round,
          // then seat the winner in the round's REAL Go league right away —
          // the first winner's win creates the league (the lobby exists from
          // minute one), later winners join it, and the 10th join starts the
          // draft exactly like a regular draft filling. A sale-while-filling
          // hands the seat to the buyer via the swap endpoint.
          const jphofTokenId = res.tokenIds[0];
          if (jphofTokenId) {
            try {
              const { joinQueueWithToken } = await import('@/lib/db');
              const { joinedRoundId } = await joinQueueWithToken(userId, jphofKind, jphofTokenId);
              if (joinedRoundId !== null) {
                const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
                await ensureSpecialDraftSeat(jphofKind, joinedRoundId, userId);
              }
            } catch (qErr) {
              logger.warn('wheel.spin.jphof_queue_failed', { spinId, userId, err: (qErr as Error).message });
            }
            // Ask OpenSea to re-pull metadata now that the pass is queued — its
            // metadata route now emits the JP/HOF Level trait while filling, so
            // a refresh makes it show under OpenSea's Level filter immediately.
            try {
              const { refreshOpenSeaTokens } = await import('@/lib/opensea');
              await refreshOpenSeaTokens([jphofTokenId]);
            } catch { /* refresh is best-effort; OpenSea re-pulls on its own too */ }
          }
          logger.info('wheel.spin.jphof_mint_ok', { spinId, userId, kind: jphofKind, txHash: res.txHash, tokenIds: res.tokenIds });
        } catch (mintErr) {
          logger.error('wheel.spin.jphof_mint_failed', { spinId, userId, kind: jphofKind, err: mintErr });
          try {
            await db.collection('failed_mints').doc(`${spinId}-jphof`).set({
              spinId,
              userId,
              count: 1,
              kind: jphofKind,
              reason: `wheel_spin:${spinId}`,
              error: (mintErr as Error)?.message ?? String(mintErr),
              createdAt: FieldValue.serverTimestamp(),
              retryable: true,
            });
          } catch (logErr) {
            logger.error('wheel.spin.jphof_failed_mint_record_error', { spinId, err: logErr });
          }
        }
      }

      // Reconcile freeDrafts to the wallet's REAL spendable inventory now the
      // mint + registration have settled. The spin tx credited freeDrafts
      // optimistically for instant feedback; this corrects it to the truth — a
      // failed mint has its phantom credit removed, a successful one confirmed.
      if (draftPassCount > 0) {
        try {
          await recountFromInventory(userId);
        } catch (e) {
          logger.warn('wheel.spin.recount_failed', { spinId, userId, err: (e as Error).message });
        }
      }

      // NOTE: NO club badge unlock at spin time (Boris 2026-06-10). Winning
      // a JP/HOF draft on the wheel unlocks the club badge when that queue
      // DRAFT FILLS — fired by the draft-filled webhook (queue-draft-filled
      // source), not here.

      if (mintOnChain && mintedTokenIds.length > 0) {
        await logActivityEvent({
          type: 'pass_granted',
          userId,
          paymentMethod: 'free',
          quantity: draftPassCount,
          tokenIds: mintedTokenIds,
          txHash: mintTxHash ?? null,
          metadata: {
            source: 'wheel_spin_mint',
            spinId,
          },
        }).catch((err) => logger.warn('wheel.spin.pass_granted_log_failed', { spinId, err: (err as Error).message }));
      }

      try {
        const twitterSnap = await db
          .collection('v2_twitter_links')
          .where('walletAddress', '==', userId.toLowerCase())
          .limit(1)
          .get();
        if (!twitterSnap.empty && twitterSnap.docs[0].data().newUserPromoClaimed) {
          const userDoc = await userRef.get();
          if (userDoc.exists && userDoc.data()?.referredBy) {
            const { updateReferralRewards } = await import('@/lib/db');
            await updateReferralRewards(userId, 'verified');
          }
        }
      } catch (refErr) {
        logger.warn('wheel.spin.referral_milestone_failed', {
          userId,
          err: (refErr as Error).message,
        });
      }

      // Legacy wallet-keyed queue. Skipped when we minted a real pass (flag ON) —
      // step 2 binds the queue to that NFT instead.
      if (jphofKind && !mintJpHof) {
        try {
          const { joinQueue } = await import('@/lib/db');
          const { joinedRoundIds } = await joinQueue(userId, jphofKind);
          logger.debug(`[wheel/spin] Auto-queued ${userId} for ${jphofKind}`);
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          for (const rid of joinedRoundIds) {
            await ensureSpecialDraftSeat(jphofKind, rid, userId);
          }
        } catch (qErr) {
          logger.warn('wheel.spin.auto_queue_failed', { userId, err: (qErr as Error).message });
        }
      }
    })());

    // The RESULT is already fully determined (claimSpinIndex derived it from the
    // period's salt+VRF+spinIndex — one small doc read + one hash). That's all
    // the wheel needs to spin to the right segment, so we return IMMEDIATELY.
    //
    // We deliberately do NOT build the Merkle proof here: generateSpinProof
    // loads EVERY leaf in the period and rebuilds the whole tree. At 10k leaves
    // that was ~15ms (invisible); at a 100k-spin season period it's a ~7MB read
    // + 100k-leaf rebuild ≈ 3s — on EVERY spin, blocking the response. The wheel
    // free-spins until this returns, so it dragged the spin out to ~5s AND let
    // the balance-reveal freeze expire mid-spin (counter updating before the
    // wheel landed). The proof is only needed for the "Verified ✓" badge, which
    // the client now fetches lazily AFTER the wheel lands via
    // GET /api/wheel/proof/{spinId} — off the critical path. periodNumber +
    // spinIndex are returned so the client knows the spin is verifiable.
    // Cost telemetry. Every settled spin logs the stack it came from, the wedge
    // it landed on and the seats actually credited, so realized $/spin can be
    // measured from logs rather than assumed from the config's expected value.
    // Query: jsonPayload.event="wheel.spin.settled" → sum seatsCredited / count.
    logger.info('wheel.spin.settled', {
      spinId,
      userId,
      spinSource,
      segmentId: segment.id,
      wedgeDrafts,
      seatsCredited: draftPassCount,
      special: jphofKind,
    });

    return json(
      {
        spinId,
        result: segment.id,
        prize,
        angle,
        mintOnChain,
        periodNumber,
        spinIndex: spinIndexInPeriod,
        // `prize.value` is the wedge; `bonusDrafts` is what was credited. They
        // differ by one on purchase spins, so result copy must read these two
        // rather than inferring the award from the wedge label.
        spinSource,
        bonusDrafts: draftPassCount,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('wheel.spin.unhandled', { route: '/api/wheel/spin', err });
    return jsonError('Internal Server Error', 500);
  }
}
