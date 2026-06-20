'use client';

import { useEffect, useRef, useState } from 'react';
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
  activityScope: 'mine' | 'all';
  onSetActivityScope: (scope: 'mine' | 'all') => void;
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
  activityScope,
  onSetActivityScope,
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

  // Resolve the from/to wallet addresses to usernames so the feed reads
  // "Boris → to Richard" instead of raw hex. Best-effort: any wallet without a
  // username falls back to a short address. Fetch is guarded by `resolvedRef`
  // (each wallet looked up once) so it never loops — Rule #0 safe.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const resolvedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const wallets = Array.from(new Set(
      activities.flatMap(a => [a.walletAddress, a.counterparty]).filter(Boolean) as string[],
    )).map(w => w.toLowerCase());
    const missing = wallets.filter(w => /^0x[0-9a-fA-F]{40}$/.test(w) && !resolvedRef.current.has(w));
    if (missing.length === 0) return;
    missing.forEach(w => resolvedRef.current.add(w)); // mark first → no refetch loop
    let cancelled = false;
    fetch(`/api/marketplace/resolve-users?wallets=${missing.join(',')}`)
      .then(r => (r.ok ? r.json() : { names: {} }))
      .then((d: { names?: Record<string, string> }) => { if (!cancelled && d.names) setNameMap(prev => ({ ...prev, ...d.names })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activities]);

  const nameFor = (w?: string | null) => {
    if (!w) return '';
    const lw = w.toLowerCase();
    return nameMap[lw] || `${w.slice(0, 6)}…${w.slice(-4)}`;
  };

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
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-lg font-semibold text-text-primary">Transaction History</h3>
            {/* Scope: just my transactions, or the whole marketplace's feed. */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-tertiary/60">
              {([['mine', 'My Activity'], ['all', 'All Activity']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => onSetActivityScope(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activityScope === key ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Look up any user's teams (by username or wallet). */}
            <Link href="/u" className="text-xs font-semibold text-banana hover:brightness-110 transition-all">🔍 Look up a user</Link>
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
        </div>

        {activityLoading && activities.length === 0 ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-14 bg-bg-tertiary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">{activityScope === 'all' ? 'No marketplace activity yet.' : 'No transaction history yet. Buy, sell, or list a team to get started.'}</p>
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
                  <div
                    key={activity.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-xl bg-bg-primary border border-bg-tertiary hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Link href={`/marketplace/${activity.tokenId}`} className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-base shrink-0">
                        {config.icon}
                      </Link>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
                          <Link href={`/marketplace/${activity.tokenId}`} className="text-text-primary text-sm font-mono hover:text-banana transition-colors truncate">{activity.teamName}</Link>
                        </div>
                        {/* Both people shown (username when set, else short
                            address), each clickable → that owner's teams. */}
                        <p className="text-text-muted text-[11px] flex items-center gap-1 flex-wrap">
                          <Link href={`/u/${activity.walletAddress}`} className="hover:text-banana transition-colors">
                            {nameFor(activity.walletAddress)}
                          </Link>
                          {activity.counterparty && (
                            <>
                              <span>{activity.type === 'buy' ? '← from' : (activity.type === 'sell' || activity.type === 'offer_accepted') ? '→ to' : '·'}</span>
                              <Link href={`/u/${activity.counterparty}`} className="hover:text-banana transition-colors">
                                {nameFor(activity.counterparty)}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {activity.price != null && (
                        <p className="text-text-primary font-mono text-sm font-medium">${activity.price.toFixed(2)}</p>
                      )}
                      <p className="text-text-muted text-[10px]">{timeAgo}</p>
                    </div>
                  </div>
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
