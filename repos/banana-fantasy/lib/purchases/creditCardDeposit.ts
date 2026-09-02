import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';

import { BASE, BASE_RPC_URL, BASE_SEPOLIA_USDC_ADDRESS } from '@/lib/contracts/bbb4';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { writeDraftPassMetadata } from '@/lib/nftCardServer';
import { recountFromInventory } from '@/lib/passLedger';
import { logActivityEvent } from '@/lib/activityEvents';
import { feeForDepositUsd, FREE_DRAFT_CREDIT_CENTS } from '@/lib/pricing';
import { FIRST_PURCHASE_MAX_SPINS, FIRST_PURCHASE_SPINS_PER_PASS } from '@/lib/promoMath';
import { firstPurchaseSpinsPerPass } from '@/lib/api/config';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { pushStreamEventBg } from '@/lib/userEventStream';
import { runInBackground } from '@/lib/serverBackground';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const USERS_COLLECTION = 'v2_users';
const FAILED_MINTS_COLLECTION = 'failed_mints';
// Same accumulator + marker collection as the card-mint path — deposits and
// card pass purchases feed ONE cardFeeCreditCents balance and share the
// once-only cardFeeFrontGranted flag, so a user can never be fronted twice.
// Deposit markers are keyed `deposit_<txHash>_<logIndex>` (mint markers use the
// bare mint txHash), so the two can't collide.
const CARD_FEE_CREDIT_COLLECTION = 'card_fee_credits';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
// ~50 minutes of Base blocks (2s each) — comfortably covers the Add Funds
// wait-for-arrival window plus a retry after a flaky first call.
const SCAN_BLOCKS = 1500n;

// no-store: Next's route-handler fetch cache serves stale responses for
// byte-identical RPC bodies (eth_blockNumber) — same bug that blinded the
// deposit-credit-sweep cron for days (2026-08-04). Never cache RPC reads here.
const client = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL, { fetchOptions: { cache: 'no-store' } }) });

export interface DepositCreditResult {
  credited: boolean;
  /** USDC actually received on-chain (dollars) for the credited transfer. */
  amountUsd: number;
  feeCents: number;
  earned: number;
  fronted: number;
  rolloverCents: number;
  draftPasses: number | null;
}

/**
 * Card-fee credit for a DEPOSIT (Add Funds) — the deposit-time analogue of
 * bookkeepPaidMint steps 4/4b/5b (⚠️ KEEP IN SYNC with that file's credit
 * semantics; like card-mint, this is deliberately a parallel implementation so
 * the live purchase path stays untouched).
 *
 * The client can only CLAIM a card deposit happened — Privy brokers the
 * MoonPay popup, so no fee or payment method ever reaches our server. What we
 * can verify is the on-chain half: a USDC transfer of ≈ the claimed amount
 * landed in the caller's wallet recently, from a sender that isn't the wallet
 * itself, and that transfer hasn't been credited before. The fee credited is
 * computed from the VERIFIED on-chain amount, never the claim.
 *
 * Known residual risk (accepted, mirrors the client-claimed paymentMethod on
 * card-mint): a user can self-report an external USDC transfer as a card
 * deposit. Bounded — the front is once per user ever (shared flag), and the
 * accumulator needs ~$435 of claimed deposits per earned pass. Marker docs
 * record sender + amount for audit.
 */
export async function creditCardDeposit(opts: {
  wallet: string;
  claimedAmountUsd: number;
}): Promise<DepositCreditResult> {
  const wallet = opts.wallet.toLowerCase();
  const claimed = opts.claimedAmountUsd;
  if (!Number.isFinite(claimed) || claimed < 5 || claimed > 10_000) {
    throw new ApiError(400, 'amountUsd out of range');
  }
  if (!isFirestoreConfigured()) throw new ApiError(503, 'Credit store unavailable');

  // 1. Find the deposit on-chain: recent USDC transfers INTO the wallet.
  const latest = await client.getBlockNumber();
  const fromBlock = latest > SCAN_BLOCKS ? latest - SCAN_BLOCKS : 0n;
  const logs = await client.getLogs({
    address: BASE_SEPOLIA_USDC_ADDRESS,
    event: TRANSFER_EVENT,
    args: { to: wallet as Address },
    fromBlock,
    toBlock: latest,
  });

  // Amount tolerance: MoonPay normally delivers the quoted amount exactly, but
  // leave room for provider rounding — ±max($2, 10%).
  const tolUsd = Math.max(2, claimed * 0.1);
  const candidates = logs
    .filter((l) => (l.args.from ?? '').toLowerCase() !== wallet)
    .map((l) => ({
      txHash: (l.transactionHash ?? '').toLowerCase(),
      logIndex: l.logIndex ?? 0,
      from: (l.args.from ?? '').toLowerCase(),
      valueUsd: Number(l.args.value ?? 0n) / 1e6,
      blockNumber: l.blockNumber ?? 0n,
    }))
    .filter((c) => c.txHash && Math.abs(c.valueUsd - claimed) <= tolUsd)
    .sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1)); // newest first

  if (candidates.length === 0) {
    throw new ApiError(404, 'No matching USDC deposit found in your wallet yet — it may still be settling.');
  }

  return creditDepositCandidates(wallet, candidates, { claimedAmountUsd: claimed });
}

export interface DepositCandidate {
  txHash: string;
  logIndex: number;
  from: string;
  valueUsd: number;
  blockNumber: bigint;
}

export interface CreditDepositOptions {
  /** Recorded on the marker as claimedAmountUsd; defaults to the credited transfer's on-chain value. */
  claimedAmountUsd?: number;
  /** Backfill: don't set firstDepositPassBudget / promise first-purchase spins for old deposits. */
  skipNewPlayerBudget?: boolean;
  /** Backfill: don't emit a deposit_completed Live Activity row for a days-old deposit. */
  suppressActivity?: boolean;
  /** Backfill: caller sends its own (aggregate) bell instead of the deposit-moment one. */
  suppressBell?: boolean;
}

/**
 * Look up the USDC Transfer(s) INTO `wallet` inside one specific transaction —
 * the targeted-tx analogue of the recent-blocks scan above. Used by the admin
 * backfill route to credit an exact audited deposit.
 */
export async function findDepositTransfersByTx(wallet: string, txHash: string): Promise<DepositCandidate[]> {
  const w = wallet.toLowerCase();
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const out: DepositCandidate[] = [];
  for (const l of receipt.logs) {
    if ((l.address ?? '').toLowerCase() !== BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) continue;
    // Transfer(address,address,uint256): topics = [sig, from, to]
    if ((l.topics?.length ?? 0) < 3) continue;
    const to = `0x${(l.topics![2] ?? '').slice(-40)}`.toLowerCase();
    if (to !== w) continue;
    const from = `0x${(l.topics![1] ?? '').slice(-40)}`.toLowerCase();
    if (from === w) continue;
    const data = l.data && l.data !== '0x' ? l.data : '0x0';
    const valueUsd = Number(BigInt(data)) / 1e6;
    if (valueUsd < 5) continue;
    out.push({
      txHash: (l.transactionHash ?? txHash).toLowerCase(),
      logIndex: l.logIndex ?? 0,
      from,
      valueUsd,
      blockNumber: l.blockNumber ?? 0n,
    });
  }
  return out;
}

/**
 * The crediting core shared by the claimed-deposit route, the cron sweep and
 * the admin backfill: claim the first unclaimed candidate atomically, run the
 * credit math, mint any earned pass, feed + bell. Extracted 2026-07-29 so
 * crediting no longer depends on the Add Funds modal staying open (4 users'
 * deposits silently missed credit — see deposit-credit-sweep cron).
 */
export async function creditDepositCandidates(
  walletAddr: string,
  candidates: DepositCandidate[],
  opts: CreditDepositOptions = {},
): Promise<DepositCreditResult> {
  const wallet = walletAddr.toLowerCase();
  if (!isFirestoreConfigured()) throw new ApiError(503, 'Credit store unavailable');
  const claimed = opts.claimedAmountUsd ?? candidates[0]?.valueUsd ?? 0;

  // Claim the newest unclaimed candidate atomically and run the credit math
  // (identical to bookkeepPaidMint step 4). The marker existence check lives
  // INSIDE the transaction so a double-submit can't double-credit.
  const db = getAdminFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(wallet);

  let creditedTx: { txHash: string; logIndex: number; from: string; valueUsd: number; feeCents: number } | null = null;
  let earned = 0;
  let fronted = 0;
  let rolloverCents = 0;
  // Pending first-purchase spins to promise in the deposit bell (NEW players
  // only): their first deposit sets a pass budget — every pass bought with it
  // earns 2 spins (see computeDepositBudgetGrant in the purchase award path).
  let pendingSpins = 0;

  for (const cand of candidates) {
    const markerRef = db.collection(CARD_FEE_CREDIT_COLLECTION).doc(`deposit_${cand.txHash}_${cand.logIndex}`);
    const feeCents = feeForDepositUsd(cand.valueUsd);
    const res = await db.runTransaction(async (tx) => {
      const marker = await tx.get(markerRef);
      if (marker.exists) return { duplicate: true, earned: 0, fronted: 0, rolloverCents: 0, pendingSpins: 0 };
      const userSnap = await tx.get(userRef);
      const udata = userSnap.data() ?? {};
      const cur = Math.max(0, (udata.cardFeeCreditCents as number | undefined) ?? 0);
      const credit = cur + feeCents;
      const front = udata.cardFeeFrontGranted === true ? 0 : 1;
      const earnedNow = front + Math.floor(credit / FREE_DRAFT_CREDIT_CENTS);
      const rollover = credit % FREE_DRAFT_CREDIT_CENTS;
      // First deposit of a NEW player (bonus untouched, not returning): set
      // the first-purchase pass budget from the verified amount, so the bell's
      // spin promise ("$50 → 4 Free Spins") is exactly honored as they buy.
      const isNewPlayer = opts.skipNewPlayerBudget !== true
        && udata.firstPurchaseBonusGranted !== true
        && udata.isReturningPlayer !== true
        && !isReturningWalletSync(wallet);
      const existingBudget = Math.max(0, (udata.firstDepositPassBudget as number | undefined) ?? 0);
      const usedBudget = Math.max(0, (udata.firstDepositPassesUsed as number | undefined) ?? 0);
      let budgetUpdate: Record<string, number> = {};
      let spinsPending = 0;
      // Budget (and therefore the bell's spin promise) is capped so the promo
      // never pays more than FIRST_PURCHASE_MAX_SPINS (Richard 2026-08-06);
      // pre-cap users with a bigger stored budget promise-and-pay only to the cap.
      const maxBudgetPasses = FIRST_PURCHASE_MAX_SPINS / FIRST_PURCHASE_SPINS_PER_PASS;
      // Bell promise uses the rate live RIGHT NOW ($100 Day flash = 4/pass
      // while open); the grant itself re-judges the rate at purchase time and
      // caps at FIRST_PURCHASE_MAX_SPINS, so the promise never overstates.
      const ratePerPass = firstPurchaseSpinsPerPass();
      if (isNewPlayer) {
        if (existingBudget === 0) {
          const budget = Math.min(Math.max(1, Math.floor(cand.valueUsd / 25)), maxBudgetPasses);
          budgetUpdate = { firstDepositPassBudget: budget };
          spinsPending = Math.min(budget * ratePerPass, FIRST_PURCHASE_MAX_SPINS);
        } else {
          spinsPending = Math.min(
            Math.max(0, Math.min(existingBudget, maxBudgetPasses) - usedBudget) * ratePerPass,
            FIRST_PURCHASE_MAX_SPINS,
          );
        }
      }
      tx.set(userRef, { cardFeeCreditCents: rollover, cardFeeFrontGranted: true, ...budgetUpdate }, { merge: true });
      tx.set(markerRef, {
        source: 'deposit',
        txHash: cand.txHash,
        logIndex: cand.logIndex,
        senderAddress: cand.from,
        userId: wallet,
        valueUsd: cand.valueUsd,
        claimedAmountUsd: claimed,
        feeCents,
        earned: earnedNow,
        fronted: front,
        status: earnedNow > 0 ? 'pending' : 'credited',
        createdAt: FieldValue.serverTimestamp(),
      });
      return { duplicate: false, earned: earnedNow, fronted: front, rolloverCents: rollover, pendingSpins: spinsPending };
    });
    if (res.duplicate) continue; // already credited (e.g. client retry) — try an older transfer
    creditedTx = { txHash: cand.txHash, logIndex: cand.logIndex, from: cand.from, valueUsd: cand.valueUsd, feeCents };
    earned = res.earned;
    fronted = res.fronted;
    rolloverCents = res.rolloverCents;
    pendingSpins = res.pendingSpins;
    break;
  }

  if (!creditedTx) {
    // Every matching transfer was already credited — idempotent success.
    logger.info(LOG_SOURCES.payment.REWARD_DUPLICATE_SKIPPED, { userId: wallet, via: 'deposit', claimed });
    return { credited: false, amountUsd: 0, feeCents: 0, earned: 0, fronted: 0, rolloverCents: 0, draftPasses: null };
  }

  logger.info(LOG_SOURCES.payment.FEE_CREDITED, {
    userId: wallet, via: 'deposit', txHash: creditedTx.txHash, valueUsd: creditedTx.valueUsd,
    feeCents: creditedTx.feeCents, rolloverCents, earned, fronted,
  });

  // The deposit itself, as its own Live Activity row — Boris wants the feed to
  // answer "who deposited, how much, via what" without a user lookup
  // (2026-07-27). OUTSIDE the earned-branch below: a deposit whose fee only
  // rolls over (earned 0) is still a deposit. The pass_granted event further
  // down is the fee-credit REWARD, a different fact.
  if (opts.suppressActivity !== true) {
    await logActivityEvent({
      type: 'deposit_completed',
      userId: wallet,
      walletAddress: wallet,
      paymentMethod: 'card',
      quantity: 0,
      txHash: creditedTx.txHash,
      metadata: { amountUsd: creditedTx.valueUsd, feeCents: creditedTx.feeCents, provider: 'moonpay' },
    }).catch(() => { /* feed row is best-effort — never fail the credit */ });
  }

  // 3. Grant any earned draft(s) as PAID-type, exactly like bookkeepPaidMint 4b.
  let rewardTokenIds: string[] = [];
  let rewardMintTxHash: string | undefined;
  let newDraftPasses: number | null = null;
  if (earned > 0) {
    try {
      const rewardMint = await reserveTokensToWallet({ to: wallet, count: earned });
      rewardTokenIds = rewardMint.tokenIds;
      rewardMintTxHash = rewardMint.txHash;
      await registerMintedTokens(wallet, rewardMint.tokenIds, 'paid');
      runInBackground('deposit.reward-pass-metadata', writeDraftPassMetadata(rewardMint.tokenIds));
      try {
        await db.collection(CARD_FEE_CREDIT_COLLECTION)
          .doc(`deposit_${creditedTx.txHash}_${creditedTx.logIndex}`)
          .set({ status: 'granted', rewardTokenIds, rewardMintTxHash }, { merge: true });
      } catch { /* marker status update is best-effort */ }
      logger.info(LOG_SOURCES.payment.REWARD_GRANTED, {
        userId: wallet, via: 'deposit', earned, rolloverCents, rewardTxHash: rewardMintTxHash, tokenIds: rewardTokenIds,
      });
    } catch (rewardErr) {
      // Credit consumed but the mint failed → user is owed a draft. Same
      // failed_mints record the card_reward retry path picks up.
      logger.error(LOG_SOURCES.payment.REWARD_GRANT_FAILED, {
        userId: wallet, via: 'deposit', earned, sourceTxHash: creditedTx.txHash, err: (rewardErr as Error).message,
      });
      try {
        await db.collection(FAILED_MINTS_COLLECTION).add({
          source: 'card_reward', userId: wallet, quantity: earned,
          sourceTxHash: creditedTx.txHash, error: (rewardErr as Error).message,
          createdAt: FieldValue.serverTimestamp(), retryable: true,
        });
      } catch { /* failed-mint record is best-effort */ }
      earned = 0;
    }

    if (earned > 0) {
      try {
        const counts = await recountFromInventory(wallet);
        newDraftPasses = counts.draftPasses;
      } catch (recErr) {
        logger.warn('depositCredit.recount_failed', { userId: wallet, err: (recErr as Error).message });
      }
      await logActivityEvent({
        type: 'pass_granted',
        userId: wallet,
        walletAddress: wallet,
        paymentMethod: 'free',
        quantity: earned,
        tokenIds: rewardTokenIds,
        txHash: rewardMintTxHash ?? null,
        metadata: {
          source: 'card_fee_reward',
          via: 'deposit',
          creditConsumedCents: FREE_DRAFT_CREDIT_CENTS * (earned - fronted),
          fronted,
          rolloverCents,
          sourceTxHash: creditedTx.txHash,
          depositAmountUsd: creditedTx.valueUsd,
        },
      }).catch((e) => logger.warn('depositCredit.reward_activity_failed', { userId: wallet, err: (e as Error).message }));
    }
  }

  // The ONE deposit-moment bell (Boris 2026-07-24): "your money's in", with
  // any free-pass award AND the pending first-purchase spins folded into a
  // single ping — replaces the separate 'promo-card-free-draft' bell on the
  // deposit path (the purchase-path version of that bell is untouched).
  if (opts.suppressBell !== true) {
    pushStreamEventBg(wallet, 'deposit-received', {
      amountUsd: Math.round(creditedTx.valueUsd),
      spins: pendingSpins,
      freePasses: earned,
      fronted: fronted > 0,
      txHash: creditedTx.txHash,
    });
  }

  return {
    credited: true,
    amountUsd: creditedTx.valueUsd,
    feeCents: creditedTx.feeCents,
    earned,
    fronted,
    rolloverCents,
    draftPasses: newDraftPasses,
  };
}
