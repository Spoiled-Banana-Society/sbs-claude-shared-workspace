// Unified balance withdrawal: creates ONE withdrawalRequests doc that
// covers every pending prize the user has, and marks each prize as
// 'processing' via the prize_overlays layer. Admin then approves the
// single request, batches via Gnosis Safe, and marks paid — at which
// point the cascade in /api/admin/withdrawals/[id] flips every
// referenced prize to paid in one stroke.
//
// This is option B from the prize-balance redesign: one user click →
// one admin row → atomic settlement of N wins.
//
// Optionally accepts `prizeIds: string[]` to restrict which prizes
// get withdrawn (used by per-prize Withdraw buttons reusing the same
// flow). Without it, defaults to all currently-pending prizes.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { createWithdrawal } from '@/lib/db';
import { getPersonaVerification, incrementCumulativeWithdrawals } from '@/lib/db-firestore';
import { logDirectWithdrawal } from '@/lib/offrampAudit';
import { markPrizesProcessing } from '@/lib/prizeOverlay';
import { logger } from '@/lib/logger';
import type { PrizeHistoryItem, PrizeWin } from '@/types';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const KYC_THRESHOLD = 2000;

async function fetchPendingWins(userId: string, origin: string): Promise<PrizeWin[]> {
  // Re-use the history endpoint as the canonical merge of go-api wins +
  // synthetic prizes + overlay statuses. Means we can't accidentally
  // diverge in how the two views compute "what's pending".
  const url = `${origin}/api/prizes/history?userId=${encodeURIComponent(userId)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new ApiError(502, 'Failed to load prize history');
  const items = (await res.json()) as PrizeHistoryItem[];
  return items.filter(
    (i): i is PrizeWin => i.type === 'win' && i.status === 'pending',
  );
}

function getOrigin(req: Request): string {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://banana-fantasy-sbs.vercel.app';
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;

  try {
    await getPrivyUser(req);
    const body = await parseBody(req);
    const userIdRaw = requireString(body.userId, 'userId').trim();
    const userId = userIdRaw.toLowerCase();
    if (!ETH_ADDRESS_RE.test(userId)) {
      return jsonError('userId must be a valid wallet address', 400);
    }

    // method is the destination type. Always 'usdc' for now — money
    // gets paid out to the user's wallet via Gnosis Safe batch. The
    // 'bank' direct rail isn't implemented yet.
    const method: 'usdc' | 'bank' =
      body.method === 'bank' ? 'bank' : 'usdc';

    // Optional restriction list. If absent, settle all pending wins.
    const requestedPrizeIds: string[] | undefined = Array.isArray(body.prizeIds)
      ? (body.prizeIds.filter((s: unknown): s is string => typeof s === 'string' && !!s))
      : undefined;

    // KYC + block rules check.
    const verification = await getPersonaVerification(userId);
    if (!verification.tier1.verified) {
      return json(
        { requiresVerification: 'basic', message: 'Identity verification required before withdrawal' },
        403,
      );
    }

    // Pull pending wins (Go API + synthetic, with overlays applied).
    const pending = await fetchPendingWins(userId, getOrigin(req));
    const targets = requestedPrizeIds
      ? pending.filter((p) => requestedPrizeIds.includes(p.id))
      : pending;

    if (targets.length === 0) {
      return jsonError('No pending prizes to withdraw', 400);
    }

    const totalAmount = targets.reduce((sum, p) => sum + (p.amount || 0), 0);
    if (totalAmount <= 0) {
      return jsonError('Total amount must be greater than zero', 400);
    }

    // Tier 2 KYC threshold check on projected total.
    const projectedCumulative = (verification.cumulativeWithdrawals || 0) + totalAmount;
    if (projectedCumulative >= KYC_THRESHOLD && !verification.tier2.verified) {
      return json(
        {
          requiresVerification: 'kyc',
          message: 'Full identity verification required for withdrawals over $2,000',
          cumulativeTotal: verification.cumulativeWithdrawals,
        },
        403,
      );
    }

    // Use the first prize's draftId as the "primary" draftId on the
    // withdrawal doc — required by createWithdrawal for compat. The
    // prizeIds array is the authoritative source of which prizes are
    // being settled. Use the user's wallet as a fallback draftId for
    // synthetic prizes that don't carry one.
    const primaryDraftId = targets.find((t) => !!t.draftId)?.draftId || targets[0].id;

    const withdrawal = await createWithdrawal(
      userId,
      primaryDraftId,
      totalAmount,
      method,
      'pending',
    );

    // Persist the prizeIds list on the withdrawal doc so the admin
    // mark-paid cascade can find every prize this withdrawal settles.
    // createWithdrawal doesn't take prizeIds, so we patch the doc.
    try {
      const { getAdminFirestore, isFirestoreConfigured } = await import('@/lib/firebaseAdmin');
      if (isFirestoreConfigured()) {
        await getAdminFirestore()
          .collection('withdrawalRequests')
          .doc(withdrawal.id)
          .set(
            {
              prizeIds: targets.map((t) => t.id),
              walletAddress: userId,
            },
            { merge: true },
          );
      }
    } catch (err) {
      logger.warn('withdraw-all.patch_prizeIds_failed', { withdrawalId: withdrawal.id, err: (err as Error).message });
    }

    // Mark prizes as processing so they show as in-flight on the next
    // /prizes load — fire-and-forget; never block the response.
    markPrizesProcessing({
      prizeIds: targets.map((t) => t.id),
      userId,
      withdrawalId: withdrawal.id,
    }).catch((err) => {
      logger.warn('withdraw-all.mark_processing_failed', { err: (err as Error).message });
    });

    // Track cumulative for KYC threshold.
    await incrementCumulativeWithdrawals(userId, totalAmount).catch(() => { /* non-fatal */ });

    // Audit log into offramp_attempts so admin sees this in Offramps.
    await logDirectWithdrawal({
      userId,
      walletAddress: userId,
      amount: totalAmount,
      method,
      withdrawalId: withdrawal.id,
      status: 'tx_pending',
      // No single draftId — multiple prizes consolidated.
    }).catch(() => { /* non-fatal */ });

    return json({
      withdrawal: { ...withdrawal, prizeIds: targets.map((t) => t.id) },
      totalAmount,
      prizeCount: targets.length,
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('withdraw-all failed:', err);
    return jsonError('Failed to process withdrawal', 500);
  }
}
