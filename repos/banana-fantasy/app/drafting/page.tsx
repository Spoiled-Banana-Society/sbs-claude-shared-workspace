'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePromos } from '@/hooks/usePromos';
import { getDraftTypeColor } from '@/lib/draftTypes';
import { Tooltip } from '@/components/ui/Tooltip';
import { PromoModal } from '@/components/modals/PromoModal';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Promo } from '@/types';
import { isStagingMode } from '@/lib/staging';
import { useActiveDrafts } from '@/hooks/useActiveDrafts';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';
import type { ApiDraftToken } from '@/lib/api/owner';
import { DRAFT_PLAYERS } from '@/lib/draftRoomConstants';

type Draft = DraftState;

// Format relative time (e.g., "5 min ago", "2 hrs ago")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function DraftingPage() {
  const router = useRouter();
  const { isLoggedIn, user, setShowLoginModal, updateUser } = useAuth();
  const promosQuery = usePromos({ userId: user?.id });
  const promos = promosQuery.promos ?? [];
  const promoCount = promos.length;
  const localDrafts = useActiveDrafts();
  const [liveDrafts, setLiveDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isLive = isStagingMode() && !!user?.walletAddress;
  const [_timers, setTimers] = useState<Record<string, number>>({});
  const [exitingDraft, setExitingDraft] = useState<Draft | null>(null);
  const [showNoPasses, setShowNoPasses] = useState(false);
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [claimedPromos, setClaimedPromos] = useState<Set<string>>(new Set());
  const [claimSuccess, setClaimSuccess] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const [promoIndex, setPromoIndex] = useState(0);
  const [promoAutoRotate, setPromoAutoRotate] = useState(true);
  const [showEntryFlow, setShowEntryFlow] = useState(false);


  const handleClaim = async (promo: Promo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (claimedPromos.has(promo.id)) return;

    setClaimedPromos(prev => new Set([...Array.from(prev), promo.id]));
    const fallbackCount = promo.claimCount || 1;
    const claimResult = await promosQuery.claimPromo(promo.id);
    if (!claimResult && user) {
      updateUser({ wheelSpins: (user.wheelSpins || 0) + fallbackCount });
    }
    setClaimSuccess({ show: true, count: claimResult?.spinsAdded ?? fallbackCount });
    setTimeout(() => setClaimSuccess({ show: false, count: 0 }), 2000);
  };

  // Build draft room URL with live mode params when applicable
  const buildDraftRoomUrl = (draft: Draft) => {
    const params = new URLSearchParams({
      id: draft.id,
      name: draft.contestName,
      speed: draft.draftSpeed,
      players: String(draft.players),
    });
    if (isLive && user?.walletAddress) {
      params.set('mode', 'live');
      params.set('wallet', user.walletAddress);
    }
    return `/draft-room?${params.toString()}`;
  };

  const handleEnterDraft = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const paidPasses = user?.draftPasses || 0;
    const freePasses = user?.freeDrafts || 0;
    const totalPasses = paidPasses + freePasses;

    if (totalPasses <= 0) {
      setShowNoPasses(true);
      return;
    }

    setShowEntryFlow(true);
  };

  const handleEntryComplete = (passType: 'paid' | 'free', speed: 'fast' | 'slow') => {
    setShowEntryFlow(false);
    enterDraftWithPassType(passType, speed);
  };

  const enterDraftWithPassType = (passType: 'paid' | 'free', speed: 'fast' | 'slow' = 'fast') => {
    if (!user?.walletAddress) return;

    // Deduct the selected pass type locally (optimistic)
    if (passType === 'paid') {
      updateUser({ draftPasses: Math.max(0, (user?.draftPasses || 0) - 1) });
    } else {
      updateUser({ freeDrafts: Math.max(0, (user?.freeDrafts || 0) - 1) });
    }

    // Navigate IMMEDIATELY to draft room — it will handle joinDraft + fill-bots
    const params = new URLSearchParams({
      speed,
      mode: 'live',
      wallet: user.walletAddress,
    });
    router.push(`/draft-room?${params.toString()}`);
  };

  // In live/staging mode, load real draft tokens from API
  useEffect(() => {
    if (!isLive) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function loadLiveDrafts() {
      try {
        const { getOwnerDraftTokens } = await import('@/lib/api/owner');
        const raw = await getOwnerDraftTokens(user!.walletAddress!);
        if (cancelled) return;
        const tokens: ApiDraftToken[] = Array.isArray(raw) ? raw : [];
        // Only show tokens that are actively in a league (have a leagueId).
        // Available/unused tokens have empty leagueId and should not appear as drafts.
        const activeTokens = tokens.filter((t) => !!t.leagueId);
        const mapped: Draft[] = activeTokens.map((t) => ({
          id: t.leagueId || t.cardId,
          contestName: t.leagueDisplayName || `BBB #${t.leagueId || t.cardId}`,
          status: 'drafting' as const,
          type: t.level === 'Jackpot' ? 'jackpot' as const : t.level === 'Hall of Fame' ? 'hof' as const : 'pro' as const,
          draftSpeed: 'fast' as const,
          players: 10,
          maxPlayers: 10,
          lastUpdated: Date.now(),
        }));
        setLiveDrafts(mapped);
      } catch (err) {
        console.error('[Drafting] Failed to load live drafts:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadLiveDrafts();
    return () => { cancelled = true; };
  }, [isLive, user]);

  // In local mode, just mark loading done (useActiveDrafts handles reactivity)
  useEffect(() => {
    if (!isLive) setIsLoading(false);
  }, [isLive]);

  // Merge local + live drafts: localStorage drafts are the source of truth for
  // filling/pre-spin phases (they have timestamps). API drafts supplement with
  // server-confirmed data. Local drafts take priority (fresher state).
  // Memoized to prevent infinite re-render loops from useEffect dependencies.
  const activeDrafts: Draft[] = useMemo(() => {
    if (!isLive) return localDrafts;
    const localIds = new Set(localDrafts.map(d => d.id));
    const apiOnly = liveDrafts.filter(d => !localIds.has(d.id));
    return [...localDrafts, ...apiOnly];
  }, [isLive, localDrafts, liveDrafts]);

  // Sort drafts: Your turn > In progress (by picks away) > Filling (oldest first, newest at bottom)
  const sortedDrafts = [...activeDrafts].sort((a, b) => {
    // Your turn drafts first
    if (a.isYourTurn && !b.isYourTurn) return -1;
    if (!a.isYourTurn && b.isYourTurn) return 1;

    // Then drafting (in progress), sorted by picks away (lower = closer to your turn)
    const aIsDrafting = a.status === 'drafting';
    const bIsDrafting = b.status === 'drafting';
    if (aIsDrafting && !bIsDrafting) return -1;
    if (!aIsDrafting && bIsDrafting) return 1;

    if (aIsDrafting && bIsDrafting) {
      return (a.currentPick || 99) - (b.currentPick || 99);
    }

    // Then filling drafts, sorted by join time (oldest first, newest at bottom)
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });

  // Initialize timers
  useEffect(() => {
    const initial: Record<string, number> = {};
    activeDrafts.forEach(draft => {
      if (draft.timeRemaining) {
        initial[draft.id] = draft.timeRemaining;
      }
    });
    setTimers(initial);
  }, [activeDrafts]);

  // Countdown timers
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(id => {
          if (updated[id] > 0) {
            updated[id] = updated[id] - 1;
          }
        });
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Force re-render every 800ms so render-time helpers show live values
  const [, setRenderTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setRenderTick(t => t + 1), 800);
    return () => clearInterval(interval);
  }, []);

  // Tick effect: advance filling simulation + auto-transition phases
  // Writes to draftStore every tick so useActiveDrafts triggers re-renders
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const allDrafts = draftStore.getActiveDrafts();

      for (const d of allDrafts) {
        // FILLING: derive count from timestamps, write to store
        if (d.phase === 'filling' && d.fillingStartedAt != null && d.fillingInitialPlayers != null) {
          const count = Math.min(10, d.fillingInitialPlayers + Math.floor((now - d.fillingStartedAt) / 800));

          // Only write if count actually changed (avoids unnecessary writes)
          if (count !== d.players) {
            draftStore.updateDraft(d.id, { players: count });
          }

          // Auto-advance: filling → pre-spin when count reaches 10
          if (count >= 10 && !d.preSpinStartedAt) {
            const fillDoneAt = d.fillingStartedAt + (10 - d.fillingInitialPlayers) * 800;
            const shuffled = [...DRAFT_PLAYERS].sort(() => Math.random() - 0.5);
            const userPos = shuffled.findIndex(p => p.isYou);
            draftStore.updateDraft(d.id, {
              phase: 'pre-spin', players: 10,
              preSpinStartedAt: fillDoneAt,
              draftOrder: shuffled, userDraftPosition: userPos,
              draftType: 'pro', type: 'pro',
            });
          }
          continue;
        }

        // PRE-SPIN / SPINNING / RESULT → DRAFTING when 60s expires
        if (['pre-spin', 'spinning', 'result'].includes(d.phase || '') && d.preSpinStartedAt) {
          if ((now - d.preSpinStartedAt) / 1000 >= 60) {
            draftStore.updateDraft(d.id, {
              phase: 'drafting', status: 'drafting',
              type: d.draftType || 'pro',
            });
          }
        }
      }
    };

    tick(); // immediate
    const interval = setInterval(tick, 800);
    return () => clearInterval(interval);
  }, []);

  // Derive live display state from timestamps (called fresh each render)
  const getLiveState = (draft: Draft): { isFilling: boolean; playerCount: number; countdown: number | null } => {
    // Filling: compute count from timestamps
    if (draft.fillingStartedAt != null && draft.fillingInitialPlayers != null && !draft.preSpinStartedAt) {
      const count = Math.min(10, draft.fillingInitialPlayers + Math.floor((Date.now() - draft.fillingStartedAt) / 800));
      return { isFilling: true, playerCount: count, countdown: null };
    }
    // Pre-spin / spinning / result: compute countdown from timestamp
    if (draft.preSpinStartedAt && ['pre-spin', 'spinning', 'result'].includes(draft.phase || '')) {
      const c = Math.max(0, Math.floor(60 - (Date.now() - draft.preSpinStartedAt) / 1000));
      return { isFilling: false, playerCount: 10, countdown: c > 0 ? c : null };
    }
    // Default (drafting phase or unknown)
    return { isFilling: draft.status === 'filling', playerCount: draft.players, countdown: null };
  };

  // Auto-rotate promos carousel
  useEffect(() => {
    if (!promoAutoRotate || promoCount === 0) return;
    const interval = setInterval(() => {
      setPromoIndex(prev => (prev + 1) % promoCount);
    }, 5000);
    return () => clearInterval(interval);
  }, [promoAutoRotate, promoCount]);

  useEffect(() => {
    if (promoCount === 0) {
      setPromoIndex(0);
      return;
    }
    if (promoIndex >= promoCount) {
      setPromoIndex(0);
    }
  }, [promoCount, promoIndex]);


  const confirmExitDraft = () => {
    if (exitingDraft) {
      // TODO: API call to exit draft and return draft pass
      console.log('Exiting draft:', exitingDraft.contestName, '- Draft pass returned');
      setExitingDraft(null);
      // In real implementation, this would remove the draft from the list
    }
  };

  // Separate drafts by status
  const _yourTurnDrafts = activeDrafts.filter(d => d.status === 'drafting' && d.isYourTurn);
  const _inProgressDrafts = activeDrafts.filter(d => d.status === 'drafting' && !d.isYourTurn);

  // Show minimal UI while loading to prevent flash
  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-white">My Drafts</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {/* Claim Success Popup */}
      {claimSuccess.show && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-banana text-black px-6 py-3 rounded-xl font-semibold shadow-lg animate-bounce">
          +{claimSuccess.count} Spin{claimSuccess.count > 1 ? 's' : ''} Claimed!
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">My Drafts</h1>
          <button
            onClick={() => {
              localStorage.removeItem('banana-active-drafts');
              localStorage.removeItem('banana-completed-drafts');
              window.location.reload();
            }}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Clear All
          </button>
        </div>
        <div className="flex items-center gap-2">
          {activeDrafts.length > 0 && (
            <button
              onClick={handleEnterDraft}
              className="w-28 py-2 text-sm font-semibold border-2 border-banana text-banana rounded-lg hover:bg-banana hover:text-black hover:scale-105 transition-all"
            >
              New Draft
            </button>
          )}
          <button
            onClick={() => router.push('/buy-drafts')}
            className="w-28 py-2 text-sm font-semibold bg-banana text-black border-2 border-banana rounded-lg hover:scale-105 transition-all"
          >
            Buy Drafts
          </button>
        </div>
      </div>

      {/* Main content: Drafts left, Promos right */}
      <div className="flex gap-6">
        {/* Left: Drafts */}
        <div className="flex-1 min-w-0">

      {/* Active Drafts */}
      {sortedDrafts.length > 0 && (
        <div className="space-y-1.5">
          {sortedDrafts.map((draft) => {
            const live = getLiveState(draft);
            const isRevealed = draft.type !== null;
            const accentColor = isRevealed ? getDraftTypeColor(draft.type!) : '#888';
            const isYourTurn = draft.isYourTurn;

            return (
              <div
                key={draft.id}
                onClick={() => router.push(buildDraftRoomUrl(draft))}
                className={`group cursor-pointer transition-all overflow-hidden rounded-lg hover:bg-white/[0.03] border-2 ${
                  isYourTurn ? 'border-banana bg-banana/10' : 'border-transparent'
                }`}
              >
                {/* Main content row - Flexbox with justify-between */}
                <div className="flex items-center justify-between px-5 py-3">
                  {/* Name */}
                  <div className="w-20 flex-shrink-0">
                    {draft.joinedAt ? (
                      <Tooltip content={`Joined ${formatRelativeTime(draft.joinedAt)}`}>
                        <span className="text-white/80 font-medium cursor-default">{draft.contestName}</span>
                      </Tooltip>
                    ) : (
                      <span className="text-white/80 font-medium">{draft.contestName}</span>
                    )}
                  </div>

                  {/* Speed */}
                  <div className="w-16 flex-shrink-0 text-center">
                    <span className="text-white/50 text-sm">{draft.draftSpeed === 'fast' ? '30 sec' : '8 hour'}</span>
                  </div>

                  {/* Type */}
                  <div className="w-28 flex-shrink-0 flex items-center justify-center gap-1.5">
                    {isRevealed ? (
                      <>
                        <span className="text-sm font-semibold" style={{ color: accentColor }}>
                          {draft.type === 'jackpot' ? 'JACKPOT' : draft.type === 'hof' ? 'HALL OF FAME' : 'PRO'}
                        </span>
                        <VerifiedBadge type="draft-type" draftType={draft.type!} size="sm" />
                      </>
                    ) : (
                      <span className="text-white/30 text-sm italic">Unrevealed</span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="w-28 flex-shrink-0 flex items-center justify-center">
                    {live.isFilling ? (
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${(live.playerCount / 10) * 100}%`,
                              backgroundColor: accentColor
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums"><span className="text-white font-semibold">{live.playerCount}</span><span className="text-white/40">/10</span></span>
                      </div>
                    ) : live.countdown !== null ? (
                      <span className="text-white/50 text-sm">Starting in {live.countdown}s</span>
                    ) : isYourTurn ? (
                      <span className="text-banana font-bold">{draft.timeRemaining}s</span>
                    ) : (
                      <span className="text-white/50 text-sm">{draft.currentPick} picks away</span>
                    )}
                  </div>

                  {/* Button */}
                  <div className="w-20 flex-shrink-0">
                    {live.isFilling ? (
                      <div className="w-full">
                        <Tooltip content="Enter draft lobby">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(buildDraftRoomUrl(draft));
                            }}
                            className="w-20 py-2 rounded-lg font-semibold text-sm transition-all hover:scale-105 bg-white text-black hover:bg-white/90 flex items-center justify-center"
                          >
                            Enter
                          </button>
                        </Tooltip>
                      </div>
                    ) : (
                      <button
                        className="w-20 py-2 rounded-lg font-semibold text-sm transition-all hover:scale-105 flex items-center justify-center"
                        style={{
                          backgroundColor: isYourTurn ? '#fbbf24' : accentColor,
                          color: isYourTurn ? '#000' : '#fff'
                        }}
                      >
                        {isYourTurn ? 'Pick Now' : 'Enter'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State - Full experience */}
      {activeDrafts.length === 0 && (
        <div className="space-y-4">
          {/* Main CTA Card */}
          <div
            className="rounded-2xl overflow-hidden border border-white/[0.06]"
            style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.08) 0%, transparent 50%)' }}
          >
            <div className="p-6 flex items-center justify-between">
              <div>
                <span className="text-banana text-xs font-bold uppercase tracking-wider">Season 4</span>
                <h2 className="text-2xl font-bold text-white mt-1">Banana Best Ball</h2>
                <p className="text-white/50 mt-1">$100,000 Prize Pool</p>
              </div>
              <div className="text-right">
                {((user?.draftPasses || 0) + (user?.freeDrafts || 0)) > 0 ? (
                  <>
                    <p className="text-white/40 text-sm mb-2">{(user?.draftPasses || 0) + (user?.freeDrafts || 0)} {((user?.draftPasses || 0) + (user?.freeDrafts || 0)) !== 1 ? 'passes' : 'pass'}</p>
                    <button
                      onClick={handleEnterDraft}
                      className="px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all"
                    >
                      Enter Draft
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-white/40 text-sm mb-2">$25 per draft</p>
                    <button
                      onClick={() => router.push('/buy-drafts')}
                      className="px-6 py-3 bg-banana text-black font-bold rounded-xl hover:brightness-110 transition-all"
                    >
                      Buy Pass
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Three type cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { type: 'pro', color: '#a855f7', odds: '94%', label: 'Pro Draft', desc: 'Standard competition', icon: '⚡' },
              { type: 'hof', color: '#D4AF37', odds: '5%', label: 'Hall of Fame', desc: 'Bonus prize pool', icon: '🏆' },
              { type: 'jackpot', color: '#ef4444', odds: '1%', label: 'Jackpot', desc: 'Skip to finals', icon: '🔥' },
            ].map((item) => (
              <div
                key={item.type}
                className="rounded-xl p-5 border border-white/[0.06]"
                style={{ background: `linear-gradient(135deg, ${item.color}12 0%, transparent 70%)` }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-3xl">{item.icon}</span>
                  <span className="text-2xl font-bold" style={{ color: item.color }}>{item.odds}</span>
                </div>
                <h3 className="text-white font-semibold">{item.label}</h3>
                <p className="text-white/40 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Guaranteed Distribution */}
          <div className="rounded-xl p-4 bg-white/[0.02] border border-white/[0.06]">
            <p className="text-white/60 text-sm text-center">
              <span className="text-white font-medium">Guaranteed distribution:</span> Every 100 drafts contains exactly 1 Jackpot, 5 HOF, and 94 Pro drafts. The order is randomized, but the distribution is guaranteed.
            </p>
          </div>

          {/* How it works */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { num: '1', title: '10 Players', desc: 'Join a draft room' },
              { num: '2', title: '30s Picks', desc: 'Fast-paced snake draft' },
              { num: '3', title: 'Team Positions', desc: 'Draft KC QB, not players' },
              { num: '4', title: 'Best Ball', desc: 'Auto-optimized lineups' },
            ].map((step) => (
              <div key={step.num} className="rounded-xl p-4 bg-white/[0.02] border border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-banana/20 text-banana font-bold flex items-center justify-center mb-3">
                  {step.num}
                </div>
                <h4 className="text-white font-medium text-sm">{step.title}</h4>
                <p className="text-white/40 text-xs mt-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>

        {/* Right: Promos Sidebar - Single Card Carousel */}
        <div className="w-56 shrink-0 hidden lg:block">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Promos</h3>
            <span className="text-xs text-white/30">
              {promoCount === 0 ? '0/0' : `${promoIndex + 1}/${promoCount}`}
            </span>
          </div>

          {/* Carousel Card */}
          {promoCount === 0 ? (
            <div className="rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] flex items-center justify-center text-sm text-[#4a4a4a]">
              No promos available
            </div>
          ) : (
            (() => {
              const promo = promos[promoIndex];
              const hasProgress = promo.progressMax !== undefined && promo.progressMax > 0;
              const progressPercent = hasProgress ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100 : 0;
              return (
                <div
                  onClick={() => setSelectedPromo(promo)}
                  className="rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] hover:border-banana hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] cursor-pointer transition-all flex flex-col"
                >
                  <h4 className="font-semibold text-[#1d1d1f] text-lg leading-snug tracking-tight text-center">
                    {promo.title.includes('→') ? (
                      <>
                        <span>{promo.title.split('→')[0].trim()}</span>
                        <br />
                        <span className="text-[#4a4a4a] text-sm font-semibold">
                          → {promo.title.split('→')[1].trim()}
                        </span>
                      </>
                    ) : (
                      <span>{promo.title}</span>
                    )}
                  </h4>
                  <div className="mt-auto">
                    {hasProgress && (
                      <div className="mb-2">
                        <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                          <span className="font-semibold">{promo.progressCurrent}/{promo.progressMax}</span>
                        </div>
                        <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#1d1d1f] rounded-full transition-all"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {promo.claimable && !claimedPromos.has(promo.id) && (
                      <button
                        onClick={(e) => handleClaim(promo, e)}
                        className="w-full py-2 bg-banana text-[#1d1d1f] text-xs font-bold rounded-full hover:scale-105 transition-all"
                      >
                        {promo.claimCount && promo.claimCount > 1 ? `CLAIM (${promo.claimCount})` : 'CLAIM'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()
          )}

          {/* Navigation Dots */}
          <div className="flex justify-center gap-1.5 mt-3">
            {promos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => { setPromoIndex(idx); setPromoAutoRotate(false); }}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === promoIndex ? 'bg-banana w-4' : 'bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          {/* Arrow Navigation */}
          <div className="flex justify-between mt-3">
            <button
              onClick={() => {
                if (promoCount === 0) return;
                setPromoIndex((promoIndex - 1 + promoCount) % promoCount);
                setPromoAutoRotate(false);
              }}
              className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm"
            >
              ← Prev
            </button>
            <button
              onClick={() => {
                if (promoCount === 0) return;
                setPromoIndex((promoIndex + 1) % promoCount);
                setPromoAutoRotate(false);
              }}
              className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* No Passes Modal */}
      {showNoPasses && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowNoPasses(false)}
        >
          <div
            className="bg-bg-secondary rounded-2xl border border-bg-elevated p-8 max-w-sm w-full text-center"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">🎟️</div>
            <h3 className="text-2xl font-bold text-white mb-3">No Draft Passes</h3>
            <p className="text-text-secondary mb-6">
              You have 0 draft passes. Purchase to enter a draft.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowNoPasses(false)}
                className="flex-1 px-4 py-3 bg-transparent border border-white/30 text-white font-medium rounded-xl hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowNoPasses(false);
                  router.push('/buy-drafts');
                }}
                className="flex-1 px-4 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
              >
                Buy Passes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Draft Confirmation Modal */}
      {exitingDraft && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setExitingDraft(null)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-sm w-full cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-2">Leave Draft?</h3>
            <p className="text-white/60 mb-6">
              Are you sure you want to leave <span className="text-white font-medium">{exitingDraft.contestName}</span>? Your draft pass will be returned.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setExitingDraft(null)}
                className="flex-1 px-4 py-3 bg-transparent border border-white/50 text-white font-medium rounded-xl hover:bg-white/10 hover:scale-105 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmExitDraft}
                className="flex-1 px-4 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-400 transition-colors"
              >
                Leave Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entry Flow Modal (Pass Type + Speed in one) */}
      <EntryFlowModal
        isOpen={showEntryFlow}
        onClose={() => setShowEntryFlow(false)}
        onComplete={handleEntryComplete}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
      />

      {/* Promo Detail Modal */}
      <PromoModal
        isOpen={!!selectedPromo}
        onClose={() => setSelectedPromo(null)}
        promo={selectedPromo}
        onClaim={(promoId) => {
          console.log('Claiming promo:', promoId);
          setSelectedPromo(null);
        }}
      />
    </div>
  );
}
