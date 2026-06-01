'use client';

import React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useContest } from '@/hooks/useContests';

export default function ContestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const contestId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { isLoggedIn, setShowLoginModal } = useAuth();
  const contestQuery = useContest(contestId);

  const contest = contestQuery.data ?? null;

  if (!contest && (contestQuery.isLoading || contestQuery.isValidating)) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <p className="text-text-secondary">Loading contest...</p>
      </div>
    );
  }

  if (!contest) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-6"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="rounded-xl border border-bg-tertiary bg-bg-secondary p-6">
          <h1 className="text-2xl font-semibold text-text-primary">Contest not found</h1>
          <p className="text-text-secondary mt-2">
            We could not find a contest with ID {contestId || 'unknown'}.
          </p>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleEnter = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    router.push('/drafting');
  };

  const handleBuy = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    router.push('/buy-drafts');
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* Contest Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-3xl font-bold text-text-primary">{contest.name}</h1>
            {contest.type === 'jackpot' && <Badge type="jackpot">Jackpot</Badge>}
            {contest.type === 'hof' && <Badge type="hof">HOF</Badge>}
          </div>
          <p className="text-text-secondary">
            {contest.currentEntries.toLocaleString()} / {contest.maxEntries.toLocaleString()} entries
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-text-muted">Entry Fee</p>
          <p className="text-3xl font-bold text-banana">{formatCurrency(contest.entryFee)}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prize Pool */}
          <Card>
            <h2 className="text-xl font-semibold text-text-primary mb-4">Prize Pool</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-sm text-text-muted">Total Prize Pool</p>
                <p className="text-3xl font-bold text-text-primary">
                  {formatCurrency(contest.prizePool)}
                  <span className="text-sm text-text-muted ml-2">GTD</span>
                </p>
              </div>
              <div>
                <p className="text-sm text-text-muted">Top Prize</p>
                <p className="text-3xl font-bold text-success">{formatCurrency(contest.topPrize)}</p>
              </div>
            </div>

            <p className="text-text-secondary text-sm mb-6">
              <span className="text-banana font-medium">{formatCurrency(contest.prizePool)} guaranteed minimum.</span>{' '}
              The prize pool grows as more players enter.
              {contest.exampleEntrants && (
                <> This breakdown is an example based on{' '}
                  <span className="text-text-primary">{contest.exampleEntrants.toLocaleString()} entrants ({Math.round(contest.exampleEntrants / 10)} leagues)</span>{' '}
                  — final payouts scale with the total pool.</>
              )}
            </p>

            {/* Prize Breakdown */}
            <div className="border-t border-bg-tertiary pt-4">
              <h4 className="font-medium text-text-primary mb-3">Prize Breakdown</h4>
              <div className="space-y-2">
                {contest.prizeBreakdown.map((prize, index) => {
                  const prevSection = index > 0 ? contest.prizeBreakdown[index - 1].section : undefined;
                  const showSection = prize.section && prize.section !== prevSection;
                  return (
                    <React.Fragment key={index}>
                      {showSection && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted pt-3 pb-1 px-1">
                          {prize.section}
                        </p>
                      )}
                      <div className="flex justify-between py-2 px-3 bg-bg-tertiary rounded-lg">
                        <span className="text-text-secondary">{prize.place}</span>
                        <span className="font-medium text-text-primary">
                          {formatCurrency(prize.amount)}
                          {prize.note && (
                            <span className="text-text-muted text-xs font-normal ml-1">{prize.note}</span>
                          )}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Roster Format */}
          <Card>
            <h2 className="text-xl font-semibold text-text-primary mb-4">Roster Format</h2>
            <div className="flex flex-wrap gap-2">
              {contest.rosterFormat.map((slot, index) => (
                <div
                  key={index}
                  className="px-4 py-2 bg-bg-tertiary rounded-lg"
                >
                  <span className="text-banana font-bold">{slot.count}x</span>
                  <span className="text-text-secondary ml-2">{slot.position}</span>
                </div>
              ))}
            </div>
            <p className="text-text-muted text-sm mt-4">
              Total roster slots: {contest.rosterFormat.reduce((sum, slot) => sum + slot.count, 0)}
            </p>
          </Card>

          {/* Scoring Rules */}
          <Card>
            <h2 className="text-xl font-semibold text-text-primary mb-4">Scoring Rules</h2>
            <div className="grid grid-cols-2 gap-2">
              {contest.scoringRules.map((rule, index) => (
                <div
                  key={index}
                  className="flex justify-between py-2 px-3 bg-bg-tertiary rounded-lg text-sm"
                >
                  <span className="text-text-secondary">{rule.action}</span>
                  <span className={`font-medium ${rule.points >= 0 ? 'text-success' : 'text-error'}`}>
                    {rule.points >= 0 ? '+' : ''}{rule.points}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* JP/HOF Chances */}
          <Card>
            <h3 className="font-semibold text-text-primary mb-4">Live Chances</h3>
            <div className="space-y-4">
              <div className="p-4 bg-jackpot/10 rounded-xl border border-jackpot/20">
                <p className="text-sm text-jackpot mb-1">Jackpot Chance</p>
                <p className="text-4xl font-bold text-jackpot">{contest.jpPercent}%</p>
              </div>
              <div className="p-4 bg-hof/10 rounded-xl border border-hof/20">
                <p className="text-sm text-hof mb-1">HOF Chance</p>
                <p className="text-4xl font-bold text-hof">{contest.hofPercent}%</p>
              </div>
            </div>
          </Card>

          {/* Schedule */}
          <Card>
            <h3 className="font-semibold text-text-primary mb-4">Schedule</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-text-muted">Start Date</span>
                <span className="text-text-primary">{contest.startDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">End Date</span>
                <span className="text-text-primary">{contest.endDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Status</span>
                <Badge type="default" className="bg-success/20 text-success border-success/30">
                  {contest.status.charAt(0).toUpperCase() + contest.status.slice(1)}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Action Buttons */}
          <Card>
            <div className="space-y-3">
              <Button size="lg" className="w-full" onClick={handleEnter}>
                Enter Draft
              </Button>
              <Button size="lg" variant="secondary" className="w-full" onClick={handleBuy}>
                Buy Draft Passes
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
