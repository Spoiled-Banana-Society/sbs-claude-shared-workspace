import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { findTweetByUserContainingUrl } from '@/lib/xApi';
import { getShareableUrl } from '@/lib/shareUtils';
import type { SpinShareType } from '@/types';

const TWITTER_LINKS_COLLECTION = 'v2_twitter_links';
const SPIN_SHARES_COLLECTION = 'v2_spin_shares';
const USERS_COLLECTION = 'v2_users';
const PROMOS_SUBCOLLECTION = 'promos';
const SPIN_SHARE_PROMO_ID = '10';

const SHARE_CREDIT_THRESHOLD = Number(process.env.NEXT_PUBLIC_SHARE_CREDIT_THRESHOLD || 3);

function isBigWin(prize: string): boolean {
  if (prize === 'jackpot' || prize === 'hof') return true;
  const m = prize.match(/^draft-(\d+)$/);
  if (m && Number(m[1]) >= 5) return true;
  return false;
}

function shareablePath(sourceId: string): string {
  return `/wheel-result/${sourceId}`;
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      throw new ApiError(503, 'Firestore not configured');
    }

    const { walletAddress: authedWallet } = await getPrivyUser(req);
    if (!authedWallet) throw new ApiError(401, 'Authenticated wallet address missing from token');

    const body = await parseBody(req);
    const shareType = requireString(body.shareType, 'shareType') as SpinShareType;
    const sourceId = requireString(body.sourceId, 'sourceId');
    const prize = requireString(body.prize, 'prize');

    if (shareType !== 'wheel') {
      throw new ApiError(400, 'Invalid shareType');
    }

    const userId = authedWallet.toLowerCase();
    const db = getAdminFirestore();

    // 1. Lookup user's X handle
    const linkSnap = await db
      .collection(TWITTER_LINKS_COLLECTION)
      .where('walletAddress', '==', userId)
      .limit(1)
      .get();

    if (linkSnap.empty) {
      return json({ verified: false, reason: 'no-x-link' });
    }
    const handle = linkSnap.docs[0].data().twitterHandle as string;

    // 2. Idempotency: has this source already been credited by this user?
    const existingShare = await db
      .collection(SPIN_SHARES_COLLECTION)
      .where('userId', '==', userId)
      .where('sourceId', '==', sourceId)
      .limit(1)
      .get();
    if (!existingShare.empty) {
      const existing = existingShare.docs[0].data();
      return json({
        verified: true,
        alreadyRecorded: true,
        earnsCredit: existing.earnsCredit,
        tweetUrl: existing.tweetUrl,
      });
    }

    // 3. Search X for the user's tweet containing the shareable URL
    const expectedUrl = getShareableUrl(shareablePath(sourceId));
    const tweet = await findTweetByUserContainingUrl(handle, expectedUrl);

    if (!tweet) {
      return json({ verified: false, reason: 'tweet-not-found', retryIn: 30 });
    }

    // 4. Record the share
    const earnsCredit = isBigWin(prize);
    const tweetUrl = `https://x.com/${handle.replace(/^@/, '')}/status/${tweet.id}`;
    const verifiedAt = new Date().toISOString();

    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const promoRef = userRef.collection(PROMOS_SUBCOLLECTION).doc(SPIN_SHARE_PROMO_ID);
    const shareRef = db.collection(SPIN_SHARES_COLLECTION).doc();

    const { verifiedShareCount, claimable } = await db.runTransaction(async (tx) => {
      // Double-check idempotency inside the txn
      const dupSnap = await tx.get(
        db.collection(SPIN_SHARES_COLLECTION)
          .where('userId', '==', userId)
          .where('sourceId', '==', sourceId)
          .limit(1),
      );
      if (!dupSnap.empty) {
        const existing = dupSnap.docs[0].data();
        return { verifiedShareCount: -1, claimable: false, _dup: true, _existing: existing };
      }

      tx.set(shareRef, {
        userId,
        shareType,
        sourceId,
        prize,
        tweetId: tweet.id,
        tweetUrl,
        earnsCredit,
        verifiedAt,
      });

      if (!earnsCredit) {
        return { verifiedShareCount: -1, claimable: false };
      }

      // Count verified shares (including the one we just wrote) with earnsCredit=true,
      // since the last promo claim reset. Simpler: read user's verifiedShareCount and increment.
      const userSnap = await tx.get(userRef);
      const prevCount = (userSnap.data()?.verifiedShareCount as number | undefined) ?? 0;
      const newCount = prevCount + 1;
      const reachedThreshold = newCount >= SHARE_CREDIT_THRESHOLD;

      tx.set(
        userRef,
        { verifiedShareCount: newCount },
        { merge: true },
      );

      if (reachedThreshold) {
        const promoSnap = await tx.get(promoRef);
        if (promoSnap.exists) {
          tx.set(
            promoRef,
            {
              claimable: true,
              claimCount: FieldValue.increment(1),
              progressCurrent: newCount,
            },
            { merge: true },
          );
        }
      } else if ((await tx.get(promoRef)).exists) {
        tx.set(
          promoRef,
          { progressCurrent: newCount },
          { merge: true },
        );
      }

      return { verifiedShareCount: newCount, claimable: reachedThreshold };
    });

    return json({
      verified: true,
      earnsCredit,
      tweetUrl,
      verifiedShareCount: Math.max(verifiedShareCount, 0),
      threshold: SHARE_CREDIT_THRESHOLD,
      claimable,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[promos/spin-share]', err);
    return jsonError('Internal Server Error', 500);
  }
}
