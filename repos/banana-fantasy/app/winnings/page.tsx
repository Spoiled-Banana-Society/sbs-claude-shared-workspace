'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { usePrizes, useEligibility } from '@/hooks/usePrizes';
import { WithdrawModal } from '@/components/modals/WithdrawModal';
import { CashOutModal } from '@/components/modals/CashOutModal';
import { VerificationModal } from '@/components/modals/VerificationModal';
import type { PrizeHistoryItem } from '@/types';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';

export default function PrizesPage() {
  const { isLoggedIn, setShowLoginModal, user, isEmbeddedWallet } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prizesQuery = usePrizes({ userId: user?.walletAddress ?? user?.id });
  const eligibilityQuery = useEligibility({ userId: user?.walletAddress ?? user?.id });
  const prizes = prizesQuery.prizes;
  const eligibility = eligibilityQuery.data;
  const hasPrizeError = Boolean(prizesQuery.error);
  const availableBalance = prizesQuery.availableBalance;
  const inFlightBalance = prizesQuery.inFlightBalance;
  const withdrawAll = prizesQuery.withdrawAll;
  const [withdrawModal, setWithdrawModal] = useState<{ isOpen: boolean; prize?: PrizeHistoryItem }>({ isOpen: false });
  const [cashOutModal, setCashOutModal] = useState<{ isOpen: boolean; prize?: PrizeHistoryItem; statusMode?: boolean }>({ isOpen: false });
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  // Amount editor state. `customAmount === null` means "withdraw all"
  // (the default). When user opens the editor we initialise to the
  // full balance so they can dial it down.
  const [customAmount, setCustomAmount] = useState<string | null>(null);

  // Web2 (embedded) users can't reach their Privy wallet directly, so their
  // on-chain USDC — team-sale proceeds, leftover mint credit, AND paid-out
  // prizes (the prize payout pays USDC straight into the wallet) — must surface
  // here as one real, cashable balance. External-wallet users manage their own
  // wallet, so we don't fold it into our withdraw UI for them.
  const [walletUsdc, setWalletUsdc] = useState(0);
  const walletForBalance = user?.walletAddress;
  useEffect(() => {
    if (!isEmbeddedWallet || !walletForBalance) { setWalletUsdc(0); return; }
    let cancelled = false;
    fetch(`/api/owner/usdc-balance?wallet=${walletForBalance}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.usdc === 'number') setWalletUsdc(d.usdc); })
      .catch(() => { /* best-effort — balance still shows prizes */ });
    return () => { cancelled = true; };
  }, [isEmbeddedWallet, walletForBalance]);

  // The cashable on-chain portion (embedded users only) and the one unified
  // "Available to withdraw" number = pending prizes + wallet USDC.
  const cashableWalletUsdc = isEmbeddedWallet ? walletUsdc : 0;
  const unifiedAvailable = availableBalance + cashableWalletUsdc;

  // Surface eligibility-fetch failures to the admin error log. useSWRLike
  // has no onError hook, so we watch the query's error field and report
  // once when it transitions to an error state.
  useEffect(() => {
    const err = eligibilityQuery.error;
    if (!err) return;
    reportClientError({
      source: LOG_SOURCES.prizes.ELIGIBILITY_FETCH_FAILED,
      message: err instanceof Error ? err.message : String(err),
      route: 'prizes',
      context: { userId: user?.walletAddress ?? user?.id },
      stack: err instanceof Error ? err.stack : undefined,
    });
  }, [eligibilityQuery.error, user?.walletAddress, user?.id]);

  // Auto-open status timeline when redirected back from Coinbase
  useEffect(() => {
    if (searchParams?.get('cashout') === 'success') {
      setCashOutModal({ isOpen: true, statusMode: true });
      // Clear the query param so refresh doesn't re-trigger
      router.replace('/winnings');
    }
  }, [searchParams, router]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatBalance = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Submit a withdrawal. If `amount` provided, backend rounds DOWN
  // greedy-oldest-first to a clean prize subset (so user sees what
  // actually got withdrawn in the success message). Omitted = take all.
  const submitWithdraw = async (amount?: number) => {
    if (!withdrawAll || withdrawing) return;
    const display = amount != null ? formatBalance(amount) : formatBalance(availableBalance);
    if (!confirm(`Withdraw ${display} to your wallet? Funds typically arrive within 24 hours.`)) return;
    setWithdrawing(true);
    setWithdrawSuccess(null);
    try {
      const res = await withdrawAll('usdc', amount);
      const actual = formatBalance(res.totalAmount);
      const note = amount != null && res.totalAmount !== amount
        ? ` (rounded from ${display} to nearest prize boundary)`
        : '';
      setWithdrawSuccess(
        `Withdrawing ${actual} (${res.prizeCount} ${res.prizeCount === 1 ? 'prize' : 'prizes'})${note}. You'll see it confirmed in activity once paid.`,
      );
      setCustomAmount(null);
    } catch (err) {
      const isVerificationGate = err && typeof err === 'object' && 'requiresVerification' in err;
      if (isVerificationGate) {
        setShowVerifyModal(true);
      } else {
        const msg = err instanceof Error ? err.message : 'Withdrawal failed';
        setWithdrawSuccess(`✗ ${msg}`);
        reportClientError({
          source: LOG_SOURCES.prizes.WITHDRAWAL_API_FAILED,
          message: msg,
          route: 'prizes',
          context: { userId: user?.walletAddress ?? user?.id, amount, availableBalance },
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const handleWithdrawAll = () => submitWithdraw();
  const handleWithdrawCustom = () => {
    const parsed = parseFloat(customAmount ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setWithdrawSuccess('✗ Enter a valid amount');
      return;
    }
    submitWithdraw(parsed);
  };

  const getStatusBadge = (item: PrizeHistoryItem) => {
    if (item.type === 'withdrawal') {
      switch (item.status) {
        case 'completed':
          return <Badge type="default" className="bg-success/20 text-success border-success/30">Completed</Badge>;
        case 'processing':
          return <Badge type="default" className="bg-warning/20 text-warning border-warning/30">Processing</Badge>;
        case 'failed':
          return <Badge type="default" className="bg-error/20 text-error border-error/30">Failed</Badge>;
        default:
          return <Badge type="default">Pending</Badge>;
      }
    }

    switch (item.status) {
      case 'paid':
        return <Badge type="default" className="bg-success/20 text-success border-success/30">Paid</Badge>;
      case 'processing':
        return <Badge type="default" className="bg-warning/20 text-warning border-warning/30">In progress</Badge>;
      case 'forfeited':
        return <Badge type="default" className="bg-error/20 text-error border-error/30">Forfeited</Badge>;
      default:
        // 'pending' means the user has won but hasn't actioned a
        // withdrawal yet. From the user's POV this is "ready to claim",
        // not "pending" (which sounds like waiting on us). Recolored
        // to banana yellow to match the Withdraw all CTA up top.
        return <Badge type="default" className="bg-banana/15 text-banana border-banana/30">Ready</Badge>;
    }
  };

  const isEligible = useMemo(() => {
    return Boolean(eligibility?.tier1Verified);
  }, [eligibility?.tier1Verified]);

  if (!isLoggedIn) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏆</div>
          <h1 className="text-3xl font-bold text-text-primary mb-4">Wallet</h1>
          <p className="text-text-secondary mb-6">
            Win drafts and your prizes will land here.
          </p>
          <button onClick={() => setShowLoginModal(true)} className="btn-primary">
            Log In to View
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary mb-6">Wallet</h1>

        {/* Balance hero — always renders, even at $0. Apple-clean:
            generous padding, soft gradient, big tracked-tight number,
            single primary action. The verification + withdraw state
            adapts inside the same card so the page never looks empty. */}
        {(() => {
          const needsW9 =
            !!eligibility?.geoState &&
            (eligibility.cumulativeWithdrawals ?? 0) >= 2000;
          // On fetch error we don't know the balance — never render "$0.00"
          // as if it were fact (a user with real winnings would panic).
          const hasBalance = !hasPrizeError && unifiedAvailable > 0;

          return (
            <>
              <div className="mb-3 rounded-3xl border border-white/[0.06] bg-gradient-to-br from-banana/[0.10] via-banana/[0.04] to-transparent p-6 sm:p-10">
                <p className="text-[13px] font-medium text-text-muted">Available to withdraw</p>
                <p className="mt-2 text-5xl sm:text-6xl font-semibold tracking-tight text-text-primary">
                  {hasPrizeError ? '—' : formatBalance(unifiedAvailable)}
                </p>
                {!hasPrizeError && cashableWalletUsdc > 0 && (
                  <p className="mt-1 text-[12px] text-text-muted">Includes prizes, team sales &amp; leftover credit</p>
                )}

                {/* Action area. Three states:
                    - balance > 0 + verified: withdraw all + edit amount
                    - balance > 0 + unverified: verify to withdraw
                    - $0: gentle nudge */}
                <div className="mt-6">
                  {hasBalance && isEligible && customAmount === null && (
                    isEmbeddedWallet ? (
                      // Web2 (embedded) users have no external wallet they manage —
                      // "send USDC to your wallet" is meaningless to them (it's the
                      // app's own hidden wallet). Their only real payout is cashing
                      // out to a bank via Coinbase. Open the cash-out for the full
                      // balance (no fixed prize → maxAmount = availableBalance).
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => setCashOutModal({ isOpen: true })}
                          className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] text-black font-semibold text-sm transition-all"
                        >
                          Cash out to bank
                        </button>
                        <p className="text-[11px] text-text-muted ml-auto text-right">
                          To your bank via Coinbase{cashableWalletUsdc < 2 ? ' · about $2 minimum to cash out' : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={handleWithdrawAll}
                          disabled={withdrawing}
                          className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all"
                        >
                          {withdrawing ? 'Withdrawing…' : 'Withdraw all'}
                        </button>
                        <button
                          onClick={() => setCustomAmount(availableBalance.toFixed(2))}
                          disabled={withdrawing}
                          className="text-sm text-text-muted hover:text-text-primary underline underline-offset-4 transition-colors disabled:opacity-50"
                        >
                          Edit amount
                        </button>
                        <p className="text-[11px] text-text-muted ml-auto">
                          Sent as USDC, arrives ~24h
                        </p>
                      </div>
                    )
                  )}

                  {hasBalance && isEligible && customAmount !== null && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-base font-medium">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={availableBalance}
                          autoFocus
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value)}
                          className="w-32 rounded-full bg-black/30 border border-white/[0.10] focus:border-banana/50 pl-7 pr-3 py-3 text-base font-semibold text-text-primary outline-none transition-colors"
                        />
                      </div>
                      <button
                        onClick={handleWithdrawCustom}
                        disabled={withdrawing}
                        className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all"
                      >
                        {withdrawing ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                      <button
                        onClick={() => setCustomAmount(null)}
                        disabled={withdrawing}
                        className="text-sm text-text-muted hover:text-text-primary underline underline-offset-4 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {hasBalance && !isEligible && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => setShowVerifyModal(true)}
                        className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] text-black font-semibold text-sm transition-all"
                      >
                        Verify to withdraw
                      </button>
                      <p className="text-[11px] text-text-muted">One-time check, ~2 min</p>
                    </div>
                  )}

                  {hasPrizeError && (
                    <p className="text-sm text-warning">
                      We couldn&apos;t load your balance. Refresh to try again — your money is safe.
                    </p>
                  )}
                </div>

                {/* Verify pill when $0 — pre-verify so withdraw is
                    instant once they win. Hidden during fetch errors;
                    the warning line above owns that state. */}
                {!hasBalance && !hasPrizeError && (
                  <div>
                    {isEligible ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-success/10 border border-success/30 px-3 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" />
                        <span className="text-sm font-medium text-success">Identity verified</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowVerifyModal(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 hover:bg-warning/20 active:scale-[0.98] transition-all px-3 py-1.5"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                        <span className="text-sm font-medium text-warning">
                          Verify your identity once to withdraw your balance
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {needsW9 && (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-bg-tertiary/60 border border-bg-tertiary px-3 py-2">
                    <span className="text-sm text-text-primary">W9 (US tax form, $2k+ withdrawn)</span>
                    {eligibility?.w9Completed ? (
                      <Badge type="default" className="bg-success/20 text-success border-success/30">Submitted</Badge>
                    ) : (
                      <Badge type="default" className="bg-warning/20 text-warning border-warning/30">Required</Badge>
                    )}
                  </div>
                )}

                {withdrawSuccess && (
                  <div className={`mt-4 rounded-xl px-4 py-3 text-xs ${
                    withdrawSuccess.startsWith('✗')
                      ? 'bg-error/10 border border-error/30 text-error'
                      : 'bg-success/10 border border-success/30 text-success'
                  }`}>
                    {withdrawSuccess}
                  </div>
                )}
              </div>

              {/* In-flight money lives in its own row below the hero,
                  not competing with the headline number. Coinbase /
                  Robinhood pattern: pending is information, never
                  visual weight. With ETA so users know when it lands. */}
              {inFlightBalance > 0 && (() => {
                // Honest ETA: 24h from when the withdrawal was actually
                // REQUESTED (its createdAt), not from page render — the
                // old version said "arrives tomorrow" forever, even for
                // a payout stuck for days.
                const inFlightWds = prizes.filter((p) => {
                  if (p.type !== 'withdrawal') return false;
                  const s = p.status as string;
                  return s === 'pending' || s === 'approved' || s === 'processing';
                });
                const newest = inFlightWds
                  .map((p) => p.createdAt)
                  .filter((d): d is string => !!d)
                  .sort()
                  .pop();
                const etaMs = newest ? new Date(newest).getTime() + 24 * 60 * 60 * 1000 : NaN;
                const overdue = Number.isFinite(etaMs) && etaMs < Date.now();
                const etaLabel = Number.isFinite(etaMs)
                  ? new Date(etaMs).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })
                  : null;
                return (
                  <div className="mb-8 flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                    <p className="text-sm text-text-secondary">
                      <span className="font-medium text-text-primary">{formatBalance(inFlightBalance)}</span>{' '}
                      {overdue || !etaLabel
                        ? 'on the way · processing is taking a little longer than usual'
                        : `on the way · arrives by ${etaLabel}`}
                    </p>
                  </div>
                );
              })()}
            </>
          );
        })()}

      <section>
        {hasPrizeError && (
          <div className="text-center py-12 rounded-2xl border border-error/20 bg-error/5">
            <p className="text-error font-medium">Unable to load prize activity</p>
            <p className="text-text-muted text-sm mt-1">Please refresh the page to try again.</p>
          </div>
        )}

        {!hasPrizeError && prizes.length > 0 && (() => {
          // Three buckets so users see what they need to do, what's
          // mid-flight, and what's already settled — instead of a single
          // pile labeled "history" that mixed unclaimed wins in.
          // We compare statuses as strings because the actual saved
          // values include 'approved'/'paid'/'denied' set by the admin
          // endpoint, which aren't on the WithdrawalStatus type.
          const isAction = (p: PrizeHistoryItem) => p.type === 'win' && p.status === 'pending';
          const isFinalized = (p: PrizeHistoryItem) => {
            if (p.type === 'win') return p.status === 'paid' || p.status === 'forfeited';
            const s = p.status as string;
            return s === 'completed' || s === 'paid' || s === 'failed' || s === 'denied';
          };
          const actionRequired = prizes.filter(isAction);
          const history = prizes.filter(isFinalized);
          const inProgress = prizes.filter((p) => !isAction(p) && !isFinalized(p));

          // Cleaner row-style cards: less heavy borders, more whitespace,
          // info hierarchy matches Apple-style list rows. The Withdraw all
          // hero is the action surface — these are read-only context.
          const renderCard = (item: PrizeHistoryItem) => (
            <div
              key={`${item.type}-${item.id}`}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03] transition-colors"
            >
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl shrink-0">
                    {item.type === 'withdrawal' ? '💸' : '🏆'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {item.type === 'withdrawal'
                        ? `Withdrawal to ${item.method === 'bank' ? 'bank' : 'wallet'}`
                        : item.contestName}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {item.type === 'withdrawal'
                        ? `Requested ${item.createdAt?.slice(0, 10) ?? ''}`
                        : item.paidDate
                          ? `Paid ${item.paidDate}`
                          : item.createdAt
                            ? `Won ${item.createdAt.slice(0, 10)}`
                            : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className={`text-base font-semibold ${
                    item.type === 'withdrawal' ? 'text-text-primary' : 'text-banana'
                  }`}>
                    {item.type === 'withdrawal' ? `−${formatCurrency(item.amount)}` : formatCurrency(item.amount)}
                  </p>
                  {getStatusBadge(item)}
                </div>
              </div>

              {item.type === 'win' && item.status === 'forfeited' && item.forfeitReason && (
                <div className="px-4 pb-4">
                  <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                    <p className="text-error text-sm">
                      <strong>Reason:</strong> {item.forfeitReason}
                    </p>
                  </div>
                </div>
              )}

              {item.type === 'win' && item.status === 'processing' && (
                <div className="px-4 pb-4">
                  <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                    <p className="text-warning text-sm">
                      Payout scheduled automatically in the next payout run.
                    </p>
                  </div>
                </div>
              )}

              {item.type === 'withdrawal' && item.status === 'failed' && (
                <div className="px-4 pb-4">
                  <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                    <p className="text-error text-sm">
                      Withdrawal failed. Please try again or contact support.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );

          return (
            <div className="space-y-6">
              {actionRequired.length > 0 && (
                <div>
                  <h3 className={`text-xs font-semibold text-warning uppercase tracking-wider ${isEligible ? 'mb-3' : 'mb-1'}`}>
                    Ready to withdraw
                  </h3>
                  {!isEligible && (
                    <p className="text-[12px] text-text-muted mb-3">
                      Verify identity above to withdraw.
                    </p>
                  )}
                  <div className="space-y-3">{actionRequired.map(renderCard)}</div>
                </div>
              )}

              {inProgress.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                    In progress
                  </h3>
                  <div className="space-y-3">{inProgress.map(renderCard)}</div>
                </div>
              )}

              {history.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                    History
                  </h3>
                  <div className="space-y-3">{history.map(renderCard)}</div>
                </div>
              )}
            </div>
          );
        })()}

      </section>

      <WithdrawModal
        isOpen={withdrawModal.isOpen}
        onClose={() => setWithdrawModal({ isOpen: false })}
        amount={withdrawModal.prize?.amount ?? 0}
        draftId={withdrawModal.prize?.type === 'win' ? withdrawModal.prize.draftId : undefined}
        userId={user?.id}
        walletAddress={user?.walletAddress}
        isEmbeddedWallet={isEmbeddedWallet}
        onWithdraw={prizesQuery.withdraw}
      />

      <CashOutModal
        isOpen={cashOutModal.isOpen}
        onClose={() => setCashOutModal({ isOpen: false })}
        maxAmount={cashOutModal.prize?.amount ?? cashableWalletUsdc}
        fixedAmount={Boolean(cashOutModal.prize)}
        draftId={cashOutModal.prize?.type === 'win' ? cashOutModal.prize.draftId : undefined}
        userId={user?.id}
        walletAddress={user?.walletAddress}
        initialStatusMode={cashOutModal.statusMode}
        onVerified={() => { eligibilityQuery.mutate(); }}
        // Embedded (web2) users have no external wallet — don't offer the
        // "keep as USDC / send to wallet" escape; bank cash-out only.
        onSwitchToUsdc={isEmbeddedWallet ? undefined : () => {
          if (cashOutModal.prize) {
            setWithdrawModal({ isOpen: true, prize: cashOutModal.prize });
          }
        }}
      />

      {/* Direct entry to KYC from the eligibility CTA at the top of
          the page. Same modal CashOutModal launches inline; sharing it
          here keeps the post-verify refetch behavior consistent. */}
      {showVerifyModal && (user?.walletAddress || user?.id) && (
        <VerificationModal
          isOpen={true}
          onClose={() => setShowVerifyModal(false)}
          userId={(user?.walletAddress || user?.id) as string}
          onComplete={() => {
            setShowVerifyModal(false);
            eligibilityQuery.mutate();
          }}
        />
      )}
      </div>
    </div>
  );
}
