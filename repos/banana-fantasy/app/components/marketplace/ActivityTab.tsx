'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ActivityEntry } from '@/hooks/useMarketplace';
import type { MarketplaceTeam } from '@/lib/opensea';

interface ActivityTabProps {
  myNfts: MarketplaceTeam[];
  myNftsLoading: boolean;
  activities: ActivityEntry[];
  activityLoading: boolean;
  activityHasMore: boolean;
  cancellingTokenId: string | null;
  onCancel: (team: MarketplaceTeam) => void;
  onLoadMoreActivity: () => void;
}

export function ActivityTab({
  myNfts,
  myNftsLoading,
  activities,
  activityLoading,
  activityHasMore,
  cancellingTokenId,
  onCancel,
  onLoadMoreActivity,
}: ActivityTabProps) {
  const activeListings = myNfts.filter(team => team.orderHash);

  // Filter the transaction history by category. Sales = money moved (buy/sell/
  // accepted offers); Listings = list/cancel; Offers = offers made. Client-side
  // over the loaded page — "Load more" pulls additional history to filter over.
  const [actFilter, setActFilter] = useState<'all' | 'sales' | 'listings' | 'offers'>('all');
  const FILTER_TYPES: Record<'sales' | 'listings' | 'offers', ActivityEntry['type'][]> = {
    sales: ['buy', 'sell', 'offer_accepted'],
    listings: ['list', 'cancel'],
    offers: ['offer_made'],
  };
  const shownActivities = actFilter === 'all'
    ? activities
    : activities.filter(a => FILTER_TYPES[actFilter].includes(a.type));

  return (
    <div className="space-y-8">
      <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          Your Active Listings
          {activeListings.length > 0 && (
            <span className="text-xs bg-banana/20 text-banana px-2 py-0.5 rounded-full font-normal">
              {activeListings.length}
            </span>
          )}
        </h3>

        {myNftsLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, index) => (
              <div key={index} className="h-16 bg-bg-tertiary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeListings.length === 0 ? (
          <p className="text-text-muted text-sm py-4 text-center">No active listings</p>
        ) : (
          <div className="space-y-3">
            {activeListings.map(team => (
              <div
                key={`listing-${team.id}`}
                className={`flex items-center justify-between p-4 rounded-xl border ${team.isHof ? 'border-hof/30 bg-hof/5' : 'border-bg-tertiary bg-bg-primary'}`}
              >
                <div className="flex items-center gap-4">
                  {team.imageUrl ? (
                    <Image src={team.imageUrl} alt={team.name} width={48} height={48} className="rounded-xl" />
                  ) : (
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${team.color} flex items-center justify-center`}>
                      <span className="text-lg">🍌</span>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-text-primary font-semibold font-mono text-sm">{team.name}</h4>
                      {team.isJackpot && <span className="px-2 py-0.5 bg-error/20 text-error text-[9px] font-bold rounded">JP</span>}
                      {team.isHof && <span className="px-2 py-0.5 bg-hof/20 text-hof text-[9px] font-bold rounded">HOF</span>}
                    </div>
                    <p className="text-text-muted text-xs mt-0.5">
                      Listed at <span className="text-banana font-mono font-semibold">${team.price?.toFixed(2)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/marketplace/${team.tokenId}`} className="text-text-secondary text-xs hover:text-text-primary transition-colors">
                    View
                  </Link>
                  <button
                    onClick={() => onCancel(team)}
                    disabled={cancellingTokenId === team.tokenId}
                    className="px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {cancellingTokenId === team.tokenId ? 'Cancelling...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="text-lg font-semibold text-text-primary">Transaction History</h3>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-tertiary/60">
            {([['all', 'All'], ['sales', 'Sales'], ['listings', 'Listings'], ['offers', 'Offers']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${actFilter === key ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activityLoading && activities.length === 0 ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-14 bg-bg-tertiary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">No transaction history yet. Buy, sell, or list a team to get started.</p>
        ) : shownActivities.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">No {actFilter} in your loaded history — try “Load more” or another filter.</p>
        ) : (
          <>
            <div className="space-y-2">
              {shownActivities.map(activity => {
                const typeConfig: Record<string, { label: string; icon: string; color: string }> = {
                  buy: { label: 'Bought', icon: '🛒', color: 'text-success' },
                  sell: { label: 'Sold', icon: '💵', color: 'text-banana' },
                  list: { label: 'Listed', icon: '📋', color: 'text-pro' },
                  cancel: { label: 'Cancelled', icon: '❌', color: 'text-error' },
                  offer_made: { label: 'Offer Made', icon: '💰', color: 'text-banana' },
                  offer_accepted: { label: 'Sold (Offer)', icon: '✅', color: 'text-success' },
                };
                const config = typeConfig[activity.type] || { label: activity.type, icon: '📝', color: 'text-text-secondary' };
                const timeAgo = formatTimeAgo(activity.timestamp);

                return (
                  <Link
                    key={activity.id}
                    href={`/marketplace/${activity.tokenId}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-bg-primary border border-bg-tertiary hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-base">
                        {config.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
                          <span className="text-text-primary text-sm font-mono">{activity.teamName}</span>
                        </div>
                        {activity.counterparty && (
                          <p className="text-text-muted text-[11px]">
                            {activity.type === 'buy' ? 'from' : 'to'} {activity.counterparty.slice(0, 6)}...{activity.counterparty.slice(-4)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {activity.price != null && (
                        <p className="text-text-primary font-mono text-sm font-medium">${activity.price.toFixed(2)}</p>
                      )}
                      <p className="text-text-muted text-[10px]">{timeAgo}</p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {activityHasMore && (
              <div className="text-center mt-4">
                <button
                  onClick={onLoadMoreActivity}
                  className="px-6 py-2 bg-bg-primary border border-bg-tertiary text-text-primary rounded-xl hover:bg-bg-tertiary transition-colors text-sm font-medium"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: string) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
