import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateNonce, generateSeed, pickWeighted } from '@/lib/rng';
import { getWheelConfig } from '@/lib/wheelConfigFirestore';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { addActivityEventToTx, buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { isWheelJpHofPassEnabled } from '@/lib/featureFlags';
import { recountFromInventory } from '@/lib/passLedger';
import { claimSpinIndex, generateSpinProof, getCurrentPeriod } from '@/lib/wheelPeriod';
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

    const { segments, segmentAngle } = await getWheelConfig();
    const seed = generateSeed();
    const nonce = generateNonce();

    // Allow forced results in staging — check multiple env signals
    const allowForcedResult =
      process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging' ||
      process.env.VERCEL_ENV === 'preview' ||
      (process.env.VERCEL_URL || '').includes('banana-fantasy') ||
      process.env.NODE_ENV === 'development';
    const forceResult =
      allowForcedResult && typeof body.forceResult === 'string' ? body.forceResult : null;
    let segment: typeof segments[number];
    let index: number;

    // If a VRF + Merkle period is currently active, claim a spin index inside
    // the same transaction that decrements `wheelSpins`. The outcome is
    // deterministically derived from the period's (salt, vrf, spinIndex) so
    // the user gets the result already locked in by the on-chain Merkle root.
    // Forced results bypass the period (staging-only override). Periods are
    // optional during rollout — if none exists, we fall back to legacy RNG so
    // the wheel keeps working until the admin opens period 1.
    const currentPeriod = forceResult ? null : await getCurrentPeriod();
    const usePeriod = currentPeriod && currentPeriod.status === 'active' && currentPeriod.spinCount < currentPeriod.maxSpins;
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
      // Outcome derived inside the user-balance transaction below.
      segment = segments[0];
      index = 0;
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

    const draftPassCount =
      segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number'
        ? segment.prizeValue
        : 0;
    const mintOnChain = isAdminMintConfigured() && draftPassCount > 0;

    // A Jackpot/HOF wheel win. When the feature flag is ON we mint a REAL pass
    // NFT for it (marked JP/HOF + wheel-origin) so the prize is a sellable asset,
    // instead of only bumping the wallet-keyed queue counter. Flag OFF → legacy
    // counter/queue path is untouched.
    const jphofKind: 'jackpot' | 'hof' | null =
      segment.prizeType === 'custom' && segment.prizeValue === 'jackpot' ? 'jackpot'
      : segment.prizeType === 'custom' && segment.prizeValue === 'hof' ? 'hof'
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
      const spinsLeft = userData?.wheelSpins ?? 0;
      if (spinsLeft <= 0) {
        throw new ApiError(429, 'No spins remaining');
      }

      // Period-aware path: atomically claim the next index in the active
      // period and derive the deterministic outcome. Done inside the same
      // tx as the user-balance decrement so concurrent spins can't double-
      // claim an index. Forced/legacy paths skip this and use the segment
      // chosen above.
      if (usePeriod && currentPeriod) {
        const claim = await claimSpinIndex(currentPeriod.periodNumber, tx);
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
      });

      // Atomic counter update with floor-of-0 on every counter so legacy
      // bad data can't cascade. Spin decrement, optional pass / entry
      // increments — all in one transaction.
      const currentSpins = Math.max(0, (userData?.wheelSpins as number | undefined) ?? 0);
      const currentFree = Math.max(0, (userData?.freeDrafts as number | undefined) ?? 0);
      const currentJp = Math.max(0, (userData?.jackpotEntries as number | undefined) ?? 0);
      const currentHof = Math.max(0, (userData?.hofEntries as number | undefined) ?? 0);

      const balanceUpdate: Record<string, number | boolean> = {
        wheelSpins: Math.max(0, currentSpins - 1),
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
          // Queue the pass by its tokenId so it enters a filling JP/HOF round.
          // create-draft resolves the current owner at fill, so a sale-while-
          // filling hands the slot to the buyer.
          const jphofTokenId = res.tokenIds[0];
          if (jphofTokenId) {
            try {
              const { joinQueueWithToken } = await import('@/lib/db');
              await joinQueueWithToken(userId, jphofKind, jphofTokenId);
            } catch (qErr) {
              logger.warn('wheel.spin.jphof_queue_failed', { spinId, userId, err: (qErr as Error).message });
            }
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
          await joinQueue(userId, jphofKind);
          logger.debug(`[wheel/spin] Auto-queued ${userId} for ${jphofKind}`);
        } catch (qErr) {
          logger.warn('wheel.spin.auto_queue_failed', { userId, err: (qErr as Error).message });
        }
      }
    })());

    // V2 verification payload: if this spin was assigned by an active
    // wheel-proof period, attach the Merkle proof so the client can verify
    // it against the on-chain root immediately. Generation rebuilds the
    // tree from stored leaves (~10-20ms for 10k leaves) — cheap enough to
    // do per-spin without caching.
    let proof: { periodNumber: number; spinIndex: number; leaf: string; path: string[]; root: string } | null = null;
    if (periodNumber !== null && spinIndexInPeriod !== null) {
      try {
        const p = await generateSpinProof(periodNumber, spinIndexInPeriod);
        proof = {
          periodNumber,
          spinIndex: spinIndexInPeriod,
          leaf: p.leaf,
          path: p.proof,
          root: p.root,
        };
      } catch (proofErr) {
        logger.warn('wheel.spin.proof_generation_failed', {
          spinId,
          periodNumber,
          spinIndex: spinIndexInPeriod,
          err: (proofErr as Error).message,
        });
      }
    }

    return json(
      { spinId, result: segment.id, prize, angle, mintOnChain, proof },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('wheel.spin.unhandled', { route: '/api/wheel/spin', err });
    return jsonError('Internal Server Error', 500);
  }
}
