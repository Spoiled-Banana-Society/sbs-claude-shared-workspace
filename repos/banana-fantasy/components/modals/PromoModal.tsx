'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Promo } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { InstallModal } from '@/components/home/AddToHomeScreenCard';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useNotificationOptIn } from '@/hooks/useNotificationOptIn';
import { JackpotWinnerCycle } from '@/components/promos/JackpotWinnerCycle';

interface PromoModalProps {
  isOpen: boolean;
  onClose: () => void;
  promo: Promo | null;
  onClaim: (promo: Promo) => void;
  isPromoClaimed?: boolean;
  onVerifyTweet?: (promoId: string) => Promise<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>;
  onGenerateReferralCode?: () => Promise<{ code: string; link: string } | null>;
}

export function PromoModal({ isOpen, onClose, promo, onClaim, isPromoClaimed = false, onVerifyTweet, onGenerateReferralCode }: PromoModalProps) {
  const router = useRouter();
  const { user, isLoggedIn, setShowLoginModal, isTwitterVerified, isTwitterLinking, twitterError, linkTwitter, newUserPromoClaimed, claimNewUserPromo } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showAdditionalRules, setShowAdditionalRules] = useState(false);
  const [claimedRewards, setClaimedRewards] = useState<Set<string>>(new Set());
  const [claimSuccess, setClaimSuccess] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const [_timerTick, setTimerTick] = useState(0);
  const [tweetVerifying, setTweetVerifying] = useState(false);
  const [tweetVerifyResult, setTweetVerifyResult] = useState<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>(null);
  const [generatingReferral, setGeneratingReferral] = useState(false);
  const [installModalBrowser, setInstallModalBrowser] = useState<'safari' | 'chrome' | null>(null);
  const { triggerInstall, isStandalone } = useInstallPrompt();
  const { isSubscribed, isLoading: notifLoading, acceptOptIn } = useNotificationOptIn();
  // Jackpot reveal flow: existing rules/progress modal stays as-is until
  // user clicks CLAIM, then we swap to the winner-picker animation. After
  // the cycle settles the user can confirm to actually claim.
  const [jpRevealing, setJpRevealing] = useState(false);
  const [jpRevealLabels, setJpRevealLabels] = useState<string[] | null>(null);
  const [jpRevealSeed, setJpRevealSeed] = useState<string | null>(null);
  const [jpRevealSettled, setJpRevealSettled] = useState(false);
  const [jpRevealError, setJpRevealError] = useState<string | null>(null);

  // Timer tick for countdown updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTimerTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format time remaining - shows 24:00:00 if timer hasn't started
  const formatTimeRemaining = (endTime?: string) => {
    if (!endTime) return '24:00:00';

    const now = Date.now();
    const end = new Date(endTime).getTime();
    const diff = end - now;

    if (diff <= 0) return '0:00:00';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };


  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setClaimedRewards(new Set());
      setClaimSuccess({ show: false, count: 0 });
      setTweetVerifying(false);
      setJpRevealing(false);
      setJpRevealLabels(null);
      setJpRevealSeed(null);
      setJpRevealSettled(false);
      setJpRevealError(null);
      // Don't reset tweetVerifyResult — preserve checkmarks across modal close/reopen
    } else if (promo?.type === 'tweet-engagement' && promo.claimable && (promo.claimCount ?? 0) > 0) {
      // Pre-populate checkmarks for already-verified tweet engagement promos
      setTweetVerifyResult({ verified: true, hasReplied: true, hasQuoted: true, alreadyVerified: true });
    }
  }, [isOpen, promo]);

  if (!promo) return null;

  // Calculate remaining claims by subtracting claimed history items
  const claimedCount = claimedRewards.size;
  const originalClaimCount = promo.claimCount || 0;
  const remainingClaims = Math.max(0, originalClaimCount - claimedCount);

  const hasProgress = promo.progressMax !== undefined && promo.progressMax > 0;
  const progressPercent = hasProgress
    ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100
    : 0;

  const _handleCopy = () => {
    if (promo.modalContent.inviteCode) {
      navigator.clipboard.writeText(promo.modalContent.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const finalizeClaim = () => {
    if (remainingClaims > 0) {
      const claimCount = remainingClaims;
      for (let i = 0; i < claimCount; i++) {
        setClaimedRewards(prev => new Set([...Array.from(prev), `main-claim-${i}`]));
      }
      if (promo.type === 'new-user') {
        claimNewUserPromo();
      }
      onClaim(promo);
      setClaimSuccess({ show: true, count: claimCount });
    }
  };

  const startJackpotReveal = async () => {
    const history = promo.modalContent.jackpotHistory;
    const draftId = history && history.length > 0 ? history[0].draftName : null;
    setJpRevealing(true);
    setJpRevealSettled(false);
    setJpRevealError(null);
    if (!draftId) {
      // Shouldn't happen — CLAIM is only enabled when there's a credited
      // hit, which always writes a history entry. Fall back to a synthetic
      // seed and generic labels so the animation still plays.
      setJpRevealSeed('jackpot-promo-fallback');
      setJpRevealLabels(null);
      return;
    }
    setJpRevealSeed(draftId);
    try {
      const res = await fetch(`/api/promos/jackpot-reveal?draftId=${encodeURIComponent(draftId)}`);
      if (!res.ok) throw new Error(`reveal lookup failed: ${res.status}`);
      const data = (await res.json()) as { labels?: string[] };
      if (Array.isArray(data?.labels) && data.labels.length === 10) {
        setJpRevealLabels(data.labels);
      } else {
        setJpRevealLabels(null);
      }
    } catch (err) {
      setJpRevealError(err instanceof Error ? err.message : 'Failed to load drafters');
      setJpRevealLabels(null);
    }
  };

  const handleClaim = () => {
    if (remainingClaims <= 0) return;
    if (promo.type === 'jackpot' && !jpRevealing) {
      startJackpotReveal();
      return;
    }
    if (promo.type === 'jackpot' && jpRevealing && !jpRevealSettled) {
      // Don't double-trigger while cycle is mid-animation
      return;
    }
    finalizeClaim();
  };

  const renderProgressSection = () => {
    if (!hasProgress) return null;

    return (
      <div className="bg-bg-tertiary rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-text-secondary text-sm">Progress</span>
          <span className="text-text-primary font-semibold">
            {promo.progressCurrent}/{promo.progressMax}
          </span>
        </div>
        <div className="h-3 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="text-text-muted text-sm mt-2">
          {promo.progressCurrent === promo.progressMax
            ? 'Completed! Claim your reward below.'
            : `Complete ${promo.progressMax! - (promo.progressCurrent || 0)} more to claim your reward.`}
        </p>
      </div>
    );
  };

  const renderDailyDraftsContent = () => (
    <>
      {renderProgressSection()}
      {/* Timer display - always show, 24:00:00 if not started */}
      <div className="bg-bg-tertiary rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Time Remaining</span>
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span className="text-xl font-bold text-banana">{formatTimeRemaining(promo.timerEndTime)}</span>
          </div>
        </div>
        {!promo.timerEndTime && (
          <p className="text-text-muted text-xs mt-2">Timer starts when you begin your first draft</p>
        )}
      </div>
      <p className="text-text-secondary text-sm">
        You&apos;ve completed {promo.progressCurrent || 0} of {promo.progressMax} drafts towards your next spin.
        {promo.claimable && promo.claimCount && promo.claimCount > 0 && (
          <span className="text-banana font-medium"> You have {promo.claimCount} {promo.claimCount === 1 ? 'spin' : 'spins'} ready to claim!</span>
        )}
      </p>
    </>
  );

  const renderPick10Content = () => {
    const handleClaimPick10 = (rewardKey: string) => {
      setClaimedRewards(prev => new Set([...Array.from(prev), rewardKey]));
      onClaim(promo);
      setClaimSuccess({ show: true, count: 1 });
    };

    const getPick10Badge = (status: 'pending' | 'claim' | 'claimed', draftName: string) => {
      const badgeClass = "w-16 py-1 rounded text-[10px] font-medium text-center";
      const rewardKey = `pick10-${draftName}`;
      const isClaimedLocally = claimedRewards.has(rewardKey);

      if (isClaimedLocally || status === 'claimed') {
        return <span className={`${badgeClass} bg-success/20 text-success`}>Claimed</span>;
      }

      if (status === 'claim') {
        return (
          <button
            onClick={() => handleClaimPick10(rewardKey)}
            className={`${badgeClass} bg-banana text-bg-primary hover:bg-banana/80 hover:scale-110  transition-all`}
          >
            Claim
          </button>
        );
      }

      return <span className={`${badgeClass} bg-bg-elevated text-text-muted`}>Pending</span>;
    };

    return (
      <>
        {/* Total Pick 10s */}
        {promo.modalContent.totalPick10s !== undefined && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-text-primary font-medium">Total Pick 10s Hit</span>
              <span className="text-2xl font-bold text-banana">{promo.modalContent.totalPick10s}</span>
            </div>
            <p className="text-text-muted text-sm mt-2">
              You&apos;ve earned {promo.modalContent.totalPick10s} spins from Pick 10s!
            </p>
          </div>
        )}

        {/* Pick 10 History */}
        {promo.modalContent.pick10History && promo.modalContent.pick10History.length > 0 && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Pick 10 History</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {promo.modalContent.pick10History.map((entry, index) => (
                <div key={index} className="flex items-center justify-between py-2 border-b border-bg-elevated last:border-0">
                  <div>
                    <p className="text-text-secondary text-sm">{entry.draftName}</p>
                    <p className="text-text-muted text-xs">{entry.date}</p>
                  </div>
                  {getPick10Badge(entry.status, entry.draftName)}
                </div>
              ))}
            </div>
          </div>
        )}
        {(!promo.modalContent.pick10History || promo.modalContent.pick10History.length === 0) && (
          <p className="text-text-muted text-sm text-center py-4">
            No Pick 10s earned yet. Enter more drafts for a chance!
          </p>
        )}
      </>
    );
  };

  const renderReferralContent = () => {
    const handleCopyLink = () => {
      if (promo.modalContent.referralLink) {
        navigator.clipboard.writeText(promo.modalContent.referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const handleClaimReferral = (rewardKey: string) => {
      setClaimedRewards(prev => new Set([...Array.from(prev), rewardKey]));
      onClaim(promo);
      setClaimSuccess({ show: true, count: 1 });
    };

    const _getStatusDisplay = (status: string, pendingReason?: string, username?: string) => {
      const badgeClass = "w-20 py-1.5 rounded-lg text-xs font-medium text-center";
      const statusKey = `${username}-status`;
      const isClaimedLocally = claimedRewards.has(statusKey);

      if (isClaimedLocally || status === 'claimed') {
        return (
          <span className={`${badgeClass} bg-success/20 text-success`}>
            Claimed
          </span>
        );
      }

      switch (status) {
        case 'pending':
          return (
            <div className="flex flex-col items-end gap-1">
              <span className={`${badgeClass} bg-banana/20 text-banana`}>
                Pending
              </span>
              {pendingReason && (
                <span className="text-[10px] text-text-muted whitespace-nowrap text-right">
                  {pendingReason}
                </span>
              )}
            </div>
          );
        case 'claim':
          return (
            <button
              onClick={() => handleClaimReferral(statusKey)}
              className={`${badgeClass} bg-banana text-bg-primary hover:bg-banana/80 hover:scale-110  transition-all`}
            >
              Claim
            </button>
          );
        default:
          return null;
      }
    };

    const getRewardBadge = (status: 'pending' | 'claim' | 'claimed', rewardType: string, username: string) => {
      const smallBadgeClass = "w-16 py-1 rounded text-[10px] font-medium text-center";
      const rewardKey = `${username}-${rewardType}`;
      const isClaimedLocally = claimedRewards.has(rewardKey);

      if (isClaimedLocally || status === 'claimed') {
        return <span className={`${smallBadgeClass} bg-success/20 text-success`}>Claimed</span>;
      }

      switch (status) {
        case 'pending':
          return <span className={`${smallBadgeClass} bg-bg-elevated text-text-muted`}>Pending</span>;
        case 'claim':
          return (
            <button
              onClick={() => handleClaimReferral(rewardKey)}
              className={`${smallBadgeClass} bg-banana text-bg-primary hover:bg-banana/80 hover:scale-110  transition-all`}
            >
              Claim
            </button>
          );
        default:
          return null;
      }
    };

    const handleGenerate = async () => {
      if (!onGenerateReferralCode) return;
      setGeneratingReferral(true);
      await onGenerateReferralCode();
      setGeneratingReferral(false);
    };

    return (
      <>
        {/* Referral Link */}
        {promo.modalContent.referralLink ? (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-2 text-text-primary">Your Referral Link</h4>
            <p className="text-text-muted text-xs mb-3">Share this link with friends to earn spins together</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-bg-elevated rounded-lg px-4 py-3 font-mono text-banana text-sm truncate">
                {promo.modalContent.referralLink}
              </div>
              <Button variant="secondary" size="sm" onClick={handleCopyLink}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-bg-tertiary rounded-xl p-4 text-center">
            <p className="text-text-secondary mb-3">Generate your unique referral link to start earning spins!</p>
            <Button onClick={handleGenerate} disabled={generatingReferral || !isLoggedIn}>
              {generatingReferral ? 'Generating...' : 'Generate Your Link'}
            </Button>
            {!isLoggedIn && (
              <p className="text-text-muted text-xs mt-2">Log in to generate your referral link</p>
            )}
          </div>
        )}

        {/* Rewards Tiers */}
        {promo.modalContent.referralRewards && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Earn Spins</h4>
            <div className="space-y-2">
              {promo.modalContent.referralRewards.map((reward, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b border-bg-elevated last:border-0">
                  <span className="text-text-secondary text-sm">{reward.milestone}</span>
                  <span className="text-banana font-medium text-sm">{reward.reward}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referral History */}
        {promo.modalContent.referralHistory && promo.modalContent.referralHistory.length > 0 && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Referral History</h4>
            <div className="space-y-4 max-h-56 overflow-y-auto scrollbar-hover pr-3">
              {[...promo.modalContent.referralHistory].sort((a, b) => {
                // Sort by reward status: claim first, pending second, claimed last
                const getOrder = (entry: typeof a) => {
                  if (!entry.rewards) return 2;
                  const statuses = [entry.rewards.verified, entry.rewards.bought1, entry.rewards.bought10];
                  if (statuses.some(s => s === 'claim')) return 0;
                  if (statuses.some(s => s === 'pending')) return 1;
                  return 2;
                };
                return getOrder(a) - getOrder(b);
              }).map((entry, index) => (
                <div key={index} className="border-b border-bg-elevated last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-text-primary font-medium">{entry.username}</p>
                      <p className="text-text-muted text-xs">{entry.dateJoined}</p>
                    </div>
                    {entry.draftsPurchased !== undefined && (
                      <span className="text-text-muted text-xs">{Math.min(entry.draftsPurchased, 10)} drafts purchased</span>
                    )}
                  </div>
                  {entry.rewards && (
                    <div className="flex gap-3 mt-2 justify-end">
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">Verified</span>
                        {getRewardBadge(entry.rewards.verified, 'Verified', entry.username)}
                      </div>
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">Bought 1</span>
                        {getRewardBadge(entry.rewards.bought1, 'Bought 1', entry.username)}
                      </div>
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">Bought 10</span>
                        {getRewardBadge(entry.rewards.bought10, 'Bought 10', entry.username)}
                      </div>
                    </div>
                  )}
                  {entry.pendingReason && entry.status === 'pending' && (
                    <p className="text-text-muted text-xs mt-2">{entry.pendingReason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderJackpotContent = () => {
    const history = promo.modalContent.jackpotHistory;
    const hasHistory = history && history.length > 0;

    if (jpRevealing && jpRevealSeed) {
      return (
        <>
          <JackpotWinnerCycle
            seed={jpRevealSeed}
            labels={jpRevealLabels ?? undefined}
            onSettled={() => setJpRevealSettled(true)}
          />
          {jpRevealError && (
            <p className="text-text-muted text-xs text-center">
              Couldn&apos;t load drafter names — animation falls back to position labels.
            </p>
          )}
        </>
      );
    }

    return (
      <>
        {renderProgressSection()}
        {hasHistory ? (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Jackpot Wins</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {history!.map((entry, index) => (
                <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                  <span className="text-text-secondary">{entry.draftName}</span>
                  <span className="text-jackpot font-semibold">{entry.amount} {entry.amount === 1 ? 'spin' : 'spins'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-text-muted text-sm text-center py-4">
            No Jackpots hit yet. Keep drafting for a chance to win!
          </p>
        )}
      </>
    );
  };

  const renderMintContent = () => {
    return (
      <>
        {renderProgressSection()}
        {promo.modalContent.totalMinted !== undefined && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-text-primary font-medium">Total Passes Purchased</span>
              <span className="text-2xl font-bold text-banana">{promo.modalContent.totalMinted}</span>
            </div>
            <p className="text-text-muted text-sm mt-2">
              You&apos;ve earned {Math.floor(promo.modalContent.totalMinted / 10)} spins from buying!
            </p>
          </div>
        )}
      </>
    );
  };

  const renderNewUserContent = () => {
    if (!isLoggedIn) {
      return (
        <div className="bg-bg-tertiary rounded-xl p-4 text-center">
          <p className="text-text-secondary mb-3">Sign in to verify your Twitter/X and claim your bonus spin.</p>
          <Button onClick={() => { onClose(); setShowLoginModal(true); }}>Log In</Button>
        </div>
      );
    }

    const verified = isTwitterVerified;

    return (
      <div className="bg-bg-tertiary rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              verified ? 'bg-success/20' : 'bg-bg-elevated'
            }`}
          >
            <svg
              className={`w-5 h-5 ${verified ? 'text-success' : 'text-text-muted'}`}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium text-text-primary">Twitter/X Verification</p>
            {verified ? (
              <p className="text-sm text-success">
                Verified {user?.xHandle ? `as ${user.xHandle}` : ''}
              </p>
            ) : (
              <p className="text-sm text-text-muted">Connect to claim</p>
            )}
            {twitterError && (
              <p className="text-sm text-error mt-1">{twitterError}</p>
            )}
          </div>
          {!verified && (
            <Button size="sm" onClick={linkTwitter} disabled={isTwitterLinking}>
              {isTwitterLinking ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderBuyBonusContent = () => (
    <div className="bg-bg-tertiary rounded-xl p-4 text-center">
      <div className="text-4xl mb-3">🎁</div>
      <p className="font-semibold mb-2 text-text-primary">Limited Time Offer!</p>
      <p className="text-text-secondary text-sm">
        Head to the Buy Drafts page to take advantage of this promotion.
      </p>
      <Button className="mt-4" onClick={() => window.location.href = '/buy-drafts'}>
        Buy Drafts
      </Button>
    </div>
  );

  const renderTweetEngagementContent = () => {
    if (!isLoggedIn) {
      return (
        <div className="bg-bg-tertiary rounded-xl p-4 text-center">
          <p className="text-text-secondary mb-3">Sign in to participate in Tweet Engagement rewards.</p>
          <Button onClick={() => { onClose(); setShowLoginModal(true); }}>Log In</Button>
        </div>
      );
    }

    const verified = isTwitterVerified;
    const alreadyClaimable = promo.claimable && (promo.claimCount ?? 0) > 0;

    const handleVerify = async () => {
      if (!onVerifyTweet || !promo) return;
      setTweetVerifying(true);
      setTweetVerifyResult(null);
      const result = await onVerifyTweet(promo.id);
      setTweetVerifying(false);
      if (result) {
        setTweetVerifyResult(result);
      } else {
        setTweetVerifyResult({ verified: false, message: 'Verification failed. Please try again.' });
      }
    };

    return (
      <>
        {/* Step 1: Twitter connection */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${verified ? 'bg-success/20' : 'bg-bg-elevated'}`}>
              <svg className={`w-5 h-5 ${verified ? 'text-success' : 'text-text-muted'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium text-text-primary">Twitter/X Connected</p>
              {verified ? (
                <p className="text-sm text-success">Verified {user?.xHandle ? `as ${user.xHandle}` : ''}</p>
              ) : (
                <p className="text-sm text-text-muted">Connect your X account first</p>
              )}
            </div>
            {!verified && (
              <Button size="sm" onClick={linkTwitter} disabled={isTwitterLinking}>
                {isTwitterLinking ? 'Connecting...' : 'Connect'}
              </Button>
            )}
          </div>
        </div>

        {/* Step 2: Open tweet & engage */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <p className="font-medium text-text-primary mb-2">Step 1: Engage with the tweet</p>
          <p className="text-text-secondary text-sm mb-3">You must <strong>both</strong> reply and quote-retweet the campaign tweet.</p>

          {/* Checklist */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${tweetVerifyResult?.hasReplied ? 'bg-success/20' : 'bg-bg-elevated'}`}>
                {tweetVerifyResult?.hasReplied ? (
                  <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-text-muted" />
                )}
              </div>
              <span className={`text-sm ${tweetVerifyResult?.hasReplied ? 'text-success' : 'text-text-secondary'}`}>
                Reply to the tweet
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${tweetVerifyResult?.hasQuoted ? 'bg-success/20' : 'bg-bg-elevated'}`}>
                {tweetVerifyResult?.hasQuoted ? (
                  <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-text-muted" />
                )}
              </div>
              <span className={`text-sm ${tweetVerifyResult?.hasQuoted ? 'text-success' : 'text-text-secondary'}`}>
                Quote-retweet the tweet
              </span>
            </div>
          </div>

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => window.open(promo.ctaLink, '_blank', 'noopener,noreferrer')}
          >
            Open Tweet on X
          </Button>
        </div>

        {/* Step 3: Verify */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <p className="font-medium text-text-primary mb-2">Step 2: Verify your engagement</p>
          <p className="text-text-secondary text-sm mb-3">
            After completing both actions, click below to verify.
          </p>
          {alreadyClaimable ? (
            <div className="flex items-center gap-2 text-success">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">Verified! Claim your spin below.</span>
            </div>
          ) : (
            <>
              <Button
                className="w-full"
                onClick={handleVerify}
                disabled={!verified || tweetVerifying || tweetVerifyResult?.verified || alreadyClaimable}
              >
                {tweetVerifying ? 'Verifying...' : 'Verify Engagement'}
              </Button>
              {!verified && (
                <p className="text-text-muted text-xs text-center mt-2">Connect your X account first</p>
              )}
            </>
          )}
          {tweetVerifyResult && !tweetVerifyResult.verified && (
            <p className="text-error text-sm mt-2">{tweetVerifyResult.message}</p>
          )}
          {tweetVerifyResult?.verified && !alreadyClaimable && (
            <div className="flex items-center gap-2 text-success mt-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">
                {tweetVerifyResult.alreadyVerified ? 'Already verified!' : 'Both verified! Claim your spin below.'}
              </span>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderAddToHomeScreenContent = () => {
    const handleInstallClick = async () => {
      if (typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
        const ua = navigator.userAgent.toLowerCase();
        const isSafari = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
        setInstallModalBrowser(isSafari ? 'safari' : 'chrome');
      } else {
        await triggerInstall();
      }
    };

    const timerEnded = promo.timerEndTime && new Date(promo.timerEndTime).getTime() <= Date.now();

    return (
      <>
        {/* Timer */}
        {promo.timerEndTime && !timerEnded && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Raffle ends in</span>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span className="text-xl font-bold text-banana tabular-nums">{formatTimeRemaining(promo.timerEndTime)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Install + entry explanation */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isStandalone ? 'bg-success/20' : 'bg-bg-elevated'}`}>
              {isStandalone ? (
                <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <p className="font-medium text-text-primary">Add SBS to your home screen</p>
              {isStandalone ? (
                <p className="text-sm text-success">Installed — you&apos;re entered!</p>
              ) : (
                <p className="text-sm text-text-muted">Once you open the app from your home screen, you&apos;re automatically entered</p>
              )}
            </div>
            {!isStandalone && (
              <Button size="sm" onClick={handleInstallClick}>
                Install
              </Button>
            )}
          </div>
        </div>

        {/* Notifications — optional, not a requirement */}
        {!isSubscribed && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-bg-elevated">
                <span className="text-lg">🔔</span>
              </div>
              <div className="flex-1">
                <p className="font-medium text-text-primary">Want draft reminders?</p>
                <p className="text-sm text-text-muted">Get notified before your drafts start</p>
              </div>
              <Button size="sm" onClick={acceptOptIn} disabled={notifLoading}>
                {notifLoading ? '...' : 'Allow'}
              </Button>
            </div>
          </div>
        )}

        {/* Post-promo state */}
        {timerEnded && (
          <div className="pt-2">
            <Button className="w-full" onClick={() => { onClose(); router.push('/banana-wheel/raffle'); }}>
              Watch the Draw
            </Button>
          </div>
        )}
      </>
    );
  };

  const renderPromoContent = () => {
    switch (promo.type) {
      case 'daily-drafts':
        return renderDailyDraftsContent();
      case 'pick-10':
        return renderPick10Content();
      case 'referral':
        return renderReferralContent();
      case 'jackpot':
        return renderJackpotContent();
      case 'mint':
        return renderMintContent();
      case 'new-user':
        return renderNewUserContent();
      case 'buy-bonus':
        return renderBuyBonusContent();
      case 'tweet-engagement':
        return renderTweetEngagementContent();
      case 'add-to-home-screen':
        return renderAddToHomeScreenContent();
      default:
        return null;
    }
  };

  // For new-user and tweet-engagement promos, require login + Twitter verification before claiming
  const requiresTwitter = promo.type === 'new-user' || promo.type === 'tweet-engagement';
  const alreadyClaimed = promo.type === 'new-user' ? newUserPromoClaimed : false;
  const baseCanClaim = promo.claimable && remainingClaims > 0 && !isPromoClaimed && !alreadyClaimed && isLoggedIn && (!requiresTwitter || isTwitterVerified);
  // Jackpot needs an extra step: clicking CLAIM once enters the reveal
  // animation; the button only finalizes after the cycle has settled.
  const canClaim = baseCanClaim && (promo.type !== 'jackpot' || !jpRevealing || jpRevealSettled);
  const jpRevealRunning = promo.type === 'jackpot' && jpRevealing && !jpRevealSettled;
  const claimButtonText = jpRevealRunning
    ? 'Picking winner…'
    : promo.type === 'jackpot' && jpRevealing && jpRevealSettled
    ? 'CONFIRM'
    : promo.type === 'jackpot' && baseCanClaim
    ? 'REVEAL'
    : remainingClaims > 1
    ? `CLAIM (${remainingClaims})`
    : 'CLAIM';

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={promo.modalContent.title} size="lg">
      <div className="space-y-5">
        {/* Explanation */}
        <div className="text-text-secondary leading-relaxed">
          <div className="flex items-start gap-2">
            <p className="whitespace-pre-line flex-1">
              {promo.type === 'buy-bonus' ? (
                <>
                  {promo.modalContent.explanation.split('free draft pass').map((part, i, arr) => (
                    <React.Fragment key={i}>
                      {part}
                      {i < arr.length - 1 && (
                        <span className="relative inline-block group">
                          <em className="italic text-white cursor-help">free draft pass</em>
                          <span className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-bg-elevated text-text-primary text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-[100] shadow-lg w-64 pointer-events-none">
                            Free drafts can only be used to draft. They cannot be used for promos.
                          </span>
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </>
              ) : (
                promo.modalContent.explanation
              )}
            </p>
            {promo.modalContent.additionalRules && (
              <button
                onClick={() => setShowAdditionalRules(!showAdditionalRules)}
                className="p-1 hover:bg-bg-tertiary rounded-full transition-colors flex-shrink-0"
                title="View additional rules"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-text-muted hover:text-text-primary"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>
            )}
          </div>
          {showAdditionalRules && promo.modalContent.additionalRules && (
            <div className="mt-3 p-3 bg-bg-tertiary rounded-lg text-sm text-text-muted">
              {promo.modalContent.additionalRules}
            </div>
          )}
        </div>

        {/* Dynamic Content Based on Promo Type */}
        {renderPromoContent()}

        {/* Claim Button (not for add-to-home-screen — it has its own CTA) */}
        {promo.type !== 'add-to-home-screen' && (
          <div className="pt-4 border-t border-bg-tertiary">
            <Button
              className={`w-full transition-all ${canClaim ? 'hover:scale-105  hover:!bg-banana' : ''}`}
              disabled={!canClaim}
              onClick={handleClaim}
            >
              {claimButtonText}
            </Button>
            {!canClaim && (
              <p className="text-text-muted text-xs text-center mt-2">
                Complete the requirements above to claim your reward
              </p>
            )}
          </div>
        )}
      </div>

      {/* Claim Success Popup */}
      {claimSuccess.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-bg-secondary rounded-2xl p-6 w-80 text-center shadow-2xl">
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="text-xl font-bold text-text-primary mb-2">Success!</h3>
            <p className="text-text-secondary mb-6">
              {promo.type === 'buy-bonus'
                ? `You got ${claimSuccess.count} free ${claimSuccess.count === 1 ? 'draft' : 'drafts'}!`
                : `You got ${claimSuccess.count} free ${claimSuccess.count === 1 ? 'spin' : 'spins'}!`}
            </p>
            <div className="flex flex-col gap-3">
              {promo.type === 'buy-bonus' ? (
                <button
                  onClick={() => {
                    setClaimSuccess({ show: false, count: 0 });
                    router.push('/drafting');
                  }}
                  className="w-full py-3 bg-banana text-bg-primary font-bold rounded-lg hover:bg-banana/90 transition-all"
                >
                  Start Drafting
                </button>
              ) : (
                <button
                  onClick={() => {
                    setClaimSuccess({ show: false, count: 0 });
                    router.push('/banana-wheel');
                  }}
                  className="w-full py-3 bg-banana text-bg-primary font-bold rounded-lg hover:bg-banana/90 transition-all"
                >
                  Spin the Wheel
                </button>
              )}
              <button
                onClick={() => setClaimSuccess({ show: false, count: 0 })}
                className="w-full py-3 bg-bg-tertiary text-text-secondary font-medium rounded-lg hover:bg-bg-elevated transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>

    {/* PWA Install Modal (opened from add-to-home-screen promo) */}
    {installModalBrowser && (
      <InstallModal
        browser={installModalBrowser}
        onClose={() => setInstallModalBrowser(null)}
      />
    )}
    </>
  );
}
