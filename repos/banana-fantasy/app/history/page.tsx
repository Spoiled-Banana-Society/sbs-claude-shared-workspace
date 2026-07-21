'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RosterView } from '@/components/standings/RosterView';
import { LeaderboardView } from '@/components/standings/LeaderboardView';
import { DraftBoardView } from '@/components/standings/DraftBoardView';
import { useAuth } from '@/hooks/useAuth';
import { useHistory } from '@/hooks/useHistory';
import { League } from '@/types';
import { useLeagues } from '@/hooks/useLeagues';

type TabType = 'roster' | 'leaderboard' | 'draftboard';

export default function HistoryPage() {
  const { isLoggedIn, setShowLoginModal, user } = useAuth();
  const _historyQuery = useHistory({ userId: user?.id });
  const leaguesQuery = useLeagues({ userId: user?.id });
  const completedLeagues = (leaguesQuery.data ?? []).filter(
    (l) => l.status === 'completed' || l.status === 'eliminated',
  );
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('roster');

  const _formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'roster', label: 'Roster' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'draftboard', label: 'Draft Board' },
  ];

  if (!isLoggedIn) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📋</div>
          <h1 className="text-3xl font-bold text-text-primary mb-4">History</h1>
          <p className="text-text-secondary mb-6">
            View your completed contests and past teams
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
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">History</h1>
        <p className="text-text-secondary">
          Completed contests and eliminated teams
        </p>
      </div>

      {/* History List */}
      <section className="mb-8">
        <Card className="p-0 overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-bg-tertiary border-b border-bg-elevated">
            <div className="col-span-4 text-sm font-medium text-text-muted uppercase tracking-wider">
              League Name
            </div>
            <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
              Final Rank
            </div>
            <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
              Final Score
            </div>
            <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
              Status
            </div>
            <div className="col-span-2 text-sm font-medium text-text-muted uppercase tracking-wider text-center">
              Draft Date
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-bg-tertiary">
            {completedLeagues.map((league) => (
              <div
                key={league.id}
                onClick={() => {
                  setSelectedLeague(league);
                  setActiveTab('roster');
                }}
                className={`
                  grid grid-cols-12 gap-4 px-6 py-4 items-center cursor-pointer transition-colors
                  ${selectedLeague?.id === league.id ? 'bg-banana/10' : 'hover:bg-bg-tertiary/50'}
                `}
              >
                {/* League Name */}
                <div className="col-span-4 flex items-center gap-2">
                  {league.prizeIndicator && (
                    <span className="text-banana">🏆</span>
                  )}
                  {league.type === 'jackpot' && <Badge type="jackpot">JP</Badge>}
                  {league.type === 'hof' && <Badge type="hof">HOF</Badge>}
                  {league.type === 'jackhof' && <Badge type="jackpot">JACKHOF</Badge>}
                  <span className="text-text-primary font-medium">{league.name}</span>
                </div>

                {/* Final Rank */}
                <div className="col-span-2 text-center">
                  <span className="font-bold text-text-primary">#{league.leagueRank}</span>
                </div>

                {/* Final Score */}
                <div className="col-span-2 text-center">
                  <span className="font-medium text-banana">{league.seasonScore}</span>
                </div>

                {/* Status */}
                <div className="col-span-2 text-center">
                  {league.status === 'completed' ? (
                    <Badge type="default" className="bg-success/20 text-success border-success/30">
                      Completed
                    </Badge>
                  ) : (
                    <Badge type="default" className="bg-error/20 text-error border-error/30">
                      Eliminated
                    </Badge>
                  )}
                </div>

                {/* Draft Date */}
                <div className="col-span-2 text-center">
                  <span className="text-text-muted">{league.draftDate}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Selected League Details */}
      {selectedLeague && (
        <section>
          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mb-6 bg-bg-secondary p-1 rounded-lg w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${activeTab === tab.id
                    ? 'bg-banana text-bg-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'roster' && <RosterView league={selectedLeague} />}
          {activeTab === 'leaderboard' && (
            <LeaderboardView gameweek={selectedLeague.draftDate || 'current'} />
          )}
          {activeTab === 'draftboard' && <DraftBoardView league={selectedLeague} />}
        </section>
      )}

      {/* Empty State */}
      {completedLeagues.length === 0 && (
        <Card className="text-center py-12">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-text-muted">No completed contests yet.</p>
          <p className="text-text-secondary mt-2">
            Your finished leagues and eliminated teams will appear here.
          </p>
        </Card>
      )}
    </div>
  );
}
