'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { usePrizes, useEligibility } from '@/hooks/usePrizes';
import { WithdrawModal } from '@/components/modals/WithdrawModal';
import { CashOutModal } from '@/components/modals/CashOutModal';
import { VerificationModal } from '@/components/modals/VerificationModal';
import type { PrizeHistoryItem } from '@/types';

export default function PrizesPage() {
  const { isLoggedIn, setShowLoginModal, user, isEmbeddedWallet } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prizesQuery = usePrizes({ userId: user?.walletAddress ?? user?.id });
  const eligibilityQuery = useEligibility({ userId: user?.walletAddress ?? user?.id });
  const prizes = prizesQuery.prizes;
  const eligibility = eligibilityQuery.data;
  const hasPrizeError = Boolean(prizesQuery.error);
  const [withdrawModal, setWithdrawModal] = useState<{ isOpen: boolean; prize?: PrizeHistoryItem }>({ isOpen: false });
  const [cashOutModal, setCashOutModal] = useState<{ isOpen: boolean; prize?: PrizeHistoryItem; statusMode?: boolean }>({ isOpen: false });
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  // Auto-open status timeline when redirected back from Coinbase
  useEffect(() => {
    if (searchParams?.get('cashout') === 'success') {
      setCashOutModal({ isOpen: true, statusMode: true });
      // Clear the query param so refresh doesn't re-trigger
      router.replace('/prizes');
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
        return <Badge type="default" className="bg-warning/20 text-warning border-warning/30">Processing</Badge>;
      case 'forfeited':
        return <Badge type="default" className="bg-error/20 text-error border-error/30">Forfeited</Badge>;
      default:
        return <Badge type="default">Pending</Badge>;
    }
  };

  const totals = useMemo(() => {
    return {
      totalWinnings: prizesQuery.totalWinnings,
      pendingWithdrawals: prizesQuery.pendingWithdrawals,
    };
  }, [prizesQuery.totalWinnings, prizesQuery.pendingWithdrawals]);

  const isEligible = useMemo(() => {
    return Boolean(eligibility?.tier1Verified);
  }, [eligibility?.tier1Verified]);

  // Users can always attempt withdrawal — Persona verification triggers inline if needed
  const canWithdrawPrizes = true;

  const verificationUrl = '/verify';

  if (!isLoggedIn) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏆</div>
          <h1 className="text-3xl font-bold text-text-primary mb-4">Prizes</h1>
          <p className="text-text-secondary mb-6">
            View your prize history and eligibility status
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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Prizes</h1>
        <p className="text-text-secondary">View your winnings and eligibility status</p>
      </div>

      {(() => {
        // Three-state header. Goal: zero noise when there's nothing
        // load-bearing for the user.
        //   1. Verified → small confirmation pill (regardless of wins)
        //   2. Not verified + has unclaimed wins → big yellow clickable
        //      CTA inviting them to verify (the click target is the
        //      whole row, no separate button)
        //   3. Not verified + no unclaimed wins → render nothing.
        //      No reason to nag a $0 user about a verification they
        //      don't need yet.
        const hasUnclaimedWin = prizes.some(
          (p) => p.type === 'win' && p.status === 'pending',
        );
        const needsW9 =
          !!eligibility?.geoState &&
          (eligibility.cumulativeWithdrawals ?? 0) >= 2000;

        if (isEligible) {
          return (
            <div className="mb-8 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-success/10 border border-success/30 px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-sm font-medium text-success">Identity verified</span>
              </div>
              {needsW9 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-bg-tertiary/60 border border-bg-tertiary px-3 py-2">
                  <span className="text-sm text-text-primary">W9 (US tax form, $2k+ withdrawn)</span>
                  {eligibility?.w9Completed ? (
                    <Badge type="default" className="bg-success/20 text-success border-success/30">Submitted</Badge>
                  ) : (
                    <Badge type="default" className="bg-warning/20 text-warning border-warning/30">Required</Badge>
                  )}
                </div>
              )}
            </div>
          );
        }

        if (!hasUnclaimedWin) return null;

        // Compact pill that matches the verified state's shape — sized
        // to its content, not the full row width. Same dot + text
        // pattern, yellow theme, clickable. No arrow, no subtitle.
        return (
          <button
            type="button"
            onClick={() => setShowVerifyModal(true)}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 hover:bg-warning/20 active:scale-[0.98] transition-all px-3 py-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            <span className="text-sm font-medium text-warning">
              Verify your identity once to withdraw winnings
            </span>
          </button>
        );
      })()}

      <section>
        {hasPrizeError && (
          <Card className="text-center py-12">
            <p className="text-error font-semibold">Unable to load prize activity</p>
            <p className="text-text-muted text-sm mt-2">Please refresh the page to try again.</p>
          </Card>
        )}

        {!hasPrizeError && prizes.length === 0 && (prizesQuery.isLoading || prizesQuery.isValidating) && (
          <Card className="text-center py-12">
            <p className="text-text-muted">Loading…</p>
          </Card>
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

          const renderCard = (item: PrizeHistoryItem) => (
            <Card key={`${item.type}-${item.id}`} className="p-0">
              <div className="p-4 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{item.type === 'withdrawal' ? '💸' : '🏆'}</span>
                  <div>
                    <h4 className="font-medium text-text-primary">
                      {item.type === 'withdrawal'
                        ? `Withdrawal to ${item.method === 'bank' ? 'Bank' : 'USDC'}`
                        : item.contestName}
                    </h4>
                    <p className={`text-2xl font-bold mt-1 ${item.type === 'withdrawal' ? 'text-text-primary' : 'text-banana'}`}>
                      {item.type === 'withdrawal' ? `-${formatCurrency(item.amount)}` : formatCurrency(item.amount)}
                    </p>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                  {getStatusBadge(item)}
                  {item.type === 'withdrawal' ? (
                    <p className="text-text-muted text-sm">Requested: {item.createdAt?.slice(0, 10)}</p>
                  ) : (
                    item.paidDate && (
                      <p className="text-text-muted text-sm">Paid on: {item.paidDate}</p>
                    )
                  )}
                  {item.type === 'win' && item.status === 'pending' && item.draftId && (
                    canWithdrawPrizes ? (
                      <button
                        onClick={() => setCashOutModal({ isOpen: true, prize: item })}
                        className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-banana text-black hover:brightness-110 transition-all"
                      >
                        Withdraw
                      </button>
                    ) : (
                      <button
                        onClick={() => router.push(verificationUrl)}
                        className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-bg-tertiary text-text-secondary hover:bg-bg-elevated transition-all"
                      >
                        Verify to withdraw
                      </button>
                    )
                  )}
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
            </Card>
          );

          return (
            <div className="space-y-6">
              {actionRequired.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-warning uppercase tracking-wider mb-3">
                    Action required
                  </h3>
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

        {/* Empty state only when fetch fully settled (not loading + not
            validating + no error) AND prizes truly empty. */}
        {!prizesQuery.error && !prizesQuery.isLoading && !prizesQuery.isValidating && prizes.length === 0 && (
          <Card className="text-center py-12">
            <div className="text-4xl mb-4">🎯</div>
            <p className="text-text-muted">No prizes yet. Start drafting to win!</p>
          </Card>
        )}
      </section>

      <Card className="mt-8 bg-gradient-to-br from-banana/10 to-bg-secondary">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-secondary mb-1">Total Winnings (Paid)</p>
            <p className="text-3xl font-bold text-banana">
              {formatCurrency(totals.totalWinnings)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-text-secondary mb-1">Pending Withdrawals</p>
            <p className="text-xl font-medium text-text-primary">
              {formatCurrency(totals.pendingWithdrawals)}
            </p>
          </div>
        </div>
      </Card>

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
        maxAmount={cashOutModal.prize?.amount ?? 0}
        fixedAmount={Boolean(cashOutModal.prize)}
        draftId={cashOutModal.prize?.type === 'win' ? cashOutModal.prize.draftId : undefined}
        userId={user?.id}
        walletAddress={user?.walletAddress}
        initialStatusMode={cashOutModal.statusMode}
        onVerified={() => { eligibilityQuery.mutate(); }}
        onSwitchToUsdc={() => {
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
  );
}
