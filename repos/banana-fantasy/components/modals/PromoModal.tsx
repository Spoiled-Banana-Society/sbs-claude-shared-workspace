'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { promoWeekendActive } from '@/lib/promoWindow';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Promo } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { JackpotWinnerCycle } from '@/components/promos/JackpotWinnerCycle';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';
import { UserPopover } from '@/components/social/UserPopover';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { API_CONFIG } from '@/lib/api/config';
import { deriveChaseState } from '@/lib/chasePromo';
import { BananaDrawReveal } from '@/components/promos/BananaDrawReveal';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

interface PromoModalProps {
  isOpen: boolean;
  onClose: () => void;
  promo: Promo | null;
  /** Replay a recorded Jackpot draw (from a noti deep-link ?draw=) —
   *  spectate mode: plays the real draw for non-winners too. */
  drawDraftId?: string | null;
  onClaim: (promo: Promo) => void;
  isPromoClaimed?: boolean;
  onVerifyTweet?: (promoId: string) => Promise<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>;
  onGenerateReferralCode?: () => Promise<{ code: string; link: string } | null>;
}


// History timestamps: new entries are full ISO (date + time); legacy ones are
// date-only strings. Render "Jun 10 · 8:42 PM" for ISO, pass legacy through.
function fmtWhen(d: string | undefined): string {
  if (!d) return '';
  if (!d.includes('T')) return d;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d;
  return `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function PromoModal({ isOpen, onClose, promo, onClaim, isPromoClaimed = false, onVerifyTweet, onGenerateReferralCode, drawDraftId = null }: PromoModalProps) {
  const router = useRouter();
  const { user, isLoggedIn, setShowLoginModal, isTwitterVerified, isTwitterLinking, twitterError, linkTwitter, newUserPromoClaimed, claimNewUserPromo } = useAuth();
  // ⛔ Client-side Pick-slot LADDER REMOVED 2026-07-26. It read the SSE's
  // legacy per-100 counters (jackpotRemaining/hofRemaining), which don't know
  // the rolling-lane era retired the ladder on 2026-07-20 — so a batch's 5th
  // HOF landing made the modal announce "Pick 6 9 10" while the server only
  // ever credited slot 10. Pick 10 is the ONLY winning slot; the server owns
  // the copy (getPick10DisplayTier → PICK_TIER_COPY), so just render it.
  const modalTitle = promo?.modalContent.title ?? '';
  // Banana Draw owns its whole modal body (renderBananaDrawContent) — leading
  // with the generic bullet list too would print the same rules twice and bury
  // the mechanic under a wall of text (Boris 2026-07-26).
  const pickExplanation = promo?.type === 'banana-draw' ? '' : (promo?.modalContent.explanation ?? '');
  const [copied, setCopied] = useState(false);
  const [claimedRewards, setClaimedRewards] = useState<Set<string>>(new Set());
  const [claimSuccess, setClaimSuccess] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const [_timerTick, setTimerTick] = useState(0);
  const [tweetVerifying, setTweetVerifying] = useState(false);
  const [tweetVerifyResult, setTweetVerifyResult] = useState<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>(null);
  const [generatingReferral, setGeneratingReferral] = useState(false);
  // Jackpot reveal flow: existing rules/progress modal stays as-is until
  // user clicks CLAIM, then we swap to the winner-picker animation. After
  // the cycle settles the user can confirm to actually claim.
  const [jpRevealing, setJpRevealing] = useState(false);
  const [jpRevealLabels, setJpRevealLabels] = useState<string[] | null>(null);
  const [jpRevealSeed, setJpRevealSeed] = useState<string | null>(null);
  const [jpRevealSettled, setJpRevealSettled] = useState(false);
  const [jpRevealError, setJpRevealError] = useState<string | null>(null);
  const [jpWinnerLabel, setJpWinnerLabel] = useState<string | null>(null);
  const [jpSeedBasis, setJpSeedBasis] = useState<string | null>(null);
  const [jpWinnerIdx, setJpWinnerIdx] = useState<number | null>(null);
  const [jpEntries, setJpEntries] = useState<{ wallet: string; name: string; slot: number }[] | null>(null);
  const [jpVrf, setJpVrf] = useState<{ period: number | null; saltHash: string | null; receiptTxHash: string | null } | null>(null);
  const [jpSpectating, setJpSpectating] = useState(false);

  // Live display names + pfps for referral history entries (default Banana
  // name or their edited name — same resolver as everywhere else). Empty
  // list (no fetch) unless the open promo is the referral one.
  const referralWallets = promo?.type === 'referral'
    ? (promo.modalContent.referralHistory ?? []).map((e) => e.referredUserId ?? null)
    : [];
  const referralUsers = useDraftRoomUsers(referralWallets);

  // Live names + pfps for jackpot draw entrants (default-or-edited, same
  // resolver as the draft room). Empty unless a draw is loaded.
  const jpEntryUsers = useDraftRoomUsers((jpEntries ?? []).map((e) => e.wallet));

  // Banana Draw names arrive ALREADY RESOLVED from the server (real username
  // or the stored bananaNumber). Deliberately not resolved client-side: the
  // old fallback derived a name from the wallet HASH, which invents handles
  // that don't match the user's real one — it read as fake data because it was.

  const BANANA_SOURCE_LABEL: Record<string, string> = {
    'draft-free': 'Free draft filled',
    'draft-paid': 'Paid draft filled',
    'referral-draft': 'A friend you invited drafted',
    'referral-purchase': 'That friend made a purchase',
  };

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

  // Spectate replay deep-link (noti → /promos?promo=4&draw=<id>).
  const spectateStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || !promo || promo.type !== 'jackpot' || !drawDraftId) return;
    if (spectateStartedRef.current === drawDraftId) return;
    spectateStartedRef.current = drawDraftId;
    void startJackpotReveal(drawDraftId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, promo?.id, drawDraftId]);

  if (!promo) return null;

  // Calculate remaining claims by subtracting claimed history items
  const claimedCount = claimedRewards.size;
  const originalClaimCount = promo.claimCount || 0;
  const remainingClaims = Math.max(0, originalClaimCount - claimedCount);

  // Binary promos (max <= 1) don't render a progress section — "0/1" says nothing.
  const hasProgress = promo.progressMax !== undefined && promo.progressMax > 1;
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

  const startJackpotReveal = async (overrideDraftId?: string, spectate = false) => {
    const history = promo.modalContent.jackpotHistory;
    const draftId = overrideDraftId ?? (history && history.length > 0 ? history[0].draftName : null);
    setJpSpectating(spectate);
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
      const data = (await res.json()) as {
        labels?: string[];
        entries?: { wallet: string; name: string; slot: number }[];
        draw?: {
          seed: string; winnerIdx?: number | null; winnerName?: string | null; seedBasis?: string;
          vrfPeriod?: number | null; saltHash?: string | null; receiptTxHash?: string | null;
        };
      };
      if (Array.isArray(data?.labels) && data.labels.length > 0) {
        setJpRevealLabels(data.labels);
      } else {
        setJpRevealLabels(null);
      }
      setJpEntries(Array.isArray(data?.entries) && data.entries.length > 0 ? data.entries : null);
      if (data?.draw) {
        // Recorded draw: replay settles on the server-recorded winner index
        // (VRF draws derive from the sealed period seed — not recomputable
        // client-side until the period reveals).
        setJpRevealSeed(data.draw.seed);
        setJpWinnerIdx(typeof data.draw.winnerIdx === 'number' ? data.draw.winnerIdx : null);
        setJpWinnerLabel(data.draw.winnerName ?? null);
        setJpSeedBasis(data.draw.seedBasis ?? null);
        setJpVrf({
          period: data.draw.vrfPeriod ?? null,
          saltHash: data.draw.saltHash ?? null,
          receiptTxHash: data.draw.receiptTxHash ?? null,
        });
      }
    } catch (err) {
      reportClientError({
        source: LOG_SOURCES.promo.JP_REVEAL_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'promos',
        context: { promoId: promo.id, promoType: promo.type, draftId },
        stack: err instanceof Error ? err.stack : undefined,
      });
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
            : promo.type === 'daily-drafts'
            ? `Complete ${promo.progressMax! - (promo.progressCurrent || 0)} more ${(promo.progressMax! - (promo.progressCurrent || 0)) === 1 ? 'draft' : 'drafts'} to claim your Free Spin.`
            : `Complete ${promo.progressMax! - (promo.progressCurrent || 0)} more to claim your reward.`}
        </p>
      </div>
    );
  };

  const renderChaseContent = () => {
    const chase = deriveChaseState(promo);
    const mc = (promo.modalContent || {}) as Record<string, unknown>;
    const history = (Array.isArray(mc.chaseHistory) ? mc.chaseHistory : []) as Array<{ date?: string; slot?: number; spins?: number; attempts?: number }>;
    const totalSpins = typeof mc.totalChaseSpins === 'number' ? mc.totalChaseSpins : 0;
    return (
      <>
        {/* Current chase state */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          {chase.active ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-muted text-xs">Matching</div>
                <div className="text-2xl font-bold text-[#f97316] leading-tight">Pick {chase.slot}</div>
              </div>
              <div className="text-right">
                <div className="text-text-muted text-xs">Next hit</div>
                <div className="text-white font-semibold">
                  Attempt {chase.attempt} → <span className="text-[#f97316]">{chase.nextHit} {chase.nextHit === 1 ? 'Spin' : 'Spins'}{chase.isMax ? ' MAX' : ''}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-text-secondary text-sm">
              Draft to lock your pick slot — then land that same slot again within 24 hours to win Free Spins.
            </p>
          )}
        </div>
        {/* Lifetime stats */}
        <div className="bg-bg-tertiary rounded-xl p-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-banana tabular-nums">{history.length}</div>
            <div className="text-text-muted text-xs mt-1">Picks Matched</div>
          </div>
          <div className="text-center border-l border-bg-elevated">
            <div className="text-2xl font-bold text-banana tabular-nums">{Math.max(totalSpins, promo.claimCount ?? 0)}</div>
            <div className="text-text-muted text-xs mt-1">Spins Won Here</div>
          </div>
        </div>
        {/* Time Remaining — always shown, 24:00:00 until a pick is locked */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Time Remaining</span>
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-banana">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span className="text-xl font-bold text-banana tabular-nums">{formatTimeRemaining(promo.timerEndTime)}</span>
            </div>
          </div>
          {!promo.timerEndTime && (
            <p className="text-text-muted text-xs mt-2">Timer starts when your next draft fills and locks your pick.</p>
          )}
        </div>
        {promo.claimable && promo.claimCount && promo.claimCount > 0 ? (
          <p className="text-banana text-sm font-medium">
            You have {promo.claimCount} {promo.claimCount === 1 ? 'spin' : 'spins'} ready to claim!
          </p>
        ) : null}
        {/* History — one row per caught pick, newest first. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">History</h4>
          {history.length > 0 ? (
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {history.map((e, index) => (
                <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                  <span className="text-text-secondary text-sm">{fmtWhen(e.date)}</span>
                  <span className="text-banana font-medium text-sm">Pick {e.slot} · {e.spins} {e.spins === 1 ? 'spin' : 'spins'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">Every time you match your pick it lands here with the date and Spins won.</p>
          )}
        </div>
      </>
    );
  };

  const renderDailyDraftsContent = () => (
    <>
      {renderProgressSection()}
      {/* Live cumulative stats — refreshed in real time off the user-event
          stream (usePromos refetches on every server promo credit). */}
      {(promo.modalContent.lifetimePaidDrafts !== undefined || promo.modalContent.totalDailyClaims !== undefined) && (
        <div className="bg-bg-tertiary rounded-xl p-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-banana tabular-nums">{promo.modalContent.lifetimePaidDrafts ?? 0}</div>
            <div className="text-text-muted text-xs mt-1">Paid Drafts All-Time</div>
          </div>
          <div className="text-center border-l border-bg-elevated">
            {/* Floor at the live unclaimed count — spins earned before the
                all-time counter existed would otherwise read 0 while CLAIM(n)
                sits right below (caught by Boris 2026-06-10). */}
            <div className="text-2xl font-bold text-banana tabular-nums">{Math.max(promo.modalContent.totalDailyClaims ?? 0, promo.claimCount ?? 0)}</div>
            <div className="text-text-muted text-xs mt-1">Spins Earned Here</div>
          </div>
        </div>
      )}
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
          <p className="text-text-muted text-xs mt-2">Timer starts when your first paid draft fills</p>
        )}
      </div>
      {/* "You've completed X of Y" line removed — the progress bar already
          says it (Boris 2026-06-10). Keep only the claim-ready callout. */}
      {promo.claimable && promo.claimCount && promo.claimCount > 0 ? (
        <p className="text-banana text-sm font-medium">
          You have {promo.claimCount} {promo.claimCount === 1 ? 'spin' : 'spins'} ready to claim!
        </p>
      ) : null}
      {/* Completion history — one row per finished 4-set, newest first.
          ALWAYS rendered (with an empty state) so every promo modal carries
          the same structure: explanation → progress → stats → History. */}
      <div className="bg-bg-tertiary rounded-xl p-4">
        <h4 className="font-semibold mb-3 text-text-primary">History</h4>
        {(promo.modalContent.dailyHistory?.length ?? 0) > 0 ? (
          <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
            {promo.modalContent.dailyHistory!.map((entry, index) => (
              <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                <span className="text-text-secondary text-sm">{fmtWhen(entry.date)}</span>
                <span className="text-banana font-medium text-sm">{entry.count}/4 drafts · 1 spin</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-text-muted text-sm">Every 4 paid drafts you complete lands here with the date.</p>
        )}
      </div>
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
        {/* Slot 10 is the only winning slot — no ladder (see the note by
            modalTitle). Copy follows the promo window: free drafts count until
            Sun 12pm PT, paid-only after. */}
        <div className="rounded-xl p-4 bg-bg-tertiary">
          <p className="text-text-secondary text-sm">
            Land <span className="text-text-primary font-semibold">slot 10</span> in a{promoWeekendActive() ? '' : ' paid'} draft for a free spin.
          </p>
        </div>

        {/* Total Pick 10s */}
        {promo.modalContent.totalPick10s !== undefined && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-text-primary font-medium">Total Picks Hit</span>
              <span className="text-2xl font-bold text-banana">{promo.modalContent.totalPick10s}</span>
            </div>
            <p className="text-text-muted text-sm mt-2">
              You&apos;ve earned {promo.modalContent.totalPick10s} spins from Picks!
            </p>
          </div>
        )}

        {/* Pick 10 History — always rendered with an empty state, matching
            every other promo's History section. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Pick History</h4>
          {promo.modalContent.pick10History && promo.modalContent.pick10History.length > 0 ? (
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {promo.modalContent.pick10History.map((entry, index) => (
                <div key={index} className="flex items-center justify-between py-2 border-b border-bg-elevated last:border-0">
                  <div>
                    <p className="text-text-secondary text-sm">{entry.draftName}</p>
                    <p className="text-text-muted text-xs">
                      {entry.slot ? `Slot ${entry.slot} · ` : ''}{fmtWhen(entry.date)}
                    </p>
                  </div>
                  {getPick10Badge(entry.status, entry.draftName)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">{'Every 10th slot pick you land lands here with the draft and date.'}</p>
          )}
        </div>
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

    const refHistory = promo.modalContent.referralHistory ?? [];
    const refRewardsEarned = refHistory.reduce((s, e) => {
      const r = e.rewards;
      if (!r) return s;
      // Spins are earned ONLY from the friend's Draft Pass purchases
      // (bought1/4/10). Verifying earns the referrer nothing, so it must NOT
      // be counted here (that was the misleading "1 spin" on verify).
      return s + [r.bought1, r.bought4, r.bought10].filter((x) => x === 'claimed' || x === 'claim').length;
    }, 0);

    return (
      <>
        {/* Live cumulative stats — friends joined + spins their milestones earned. */}
        <div className="bg-bg-tertiary rounded-xl p-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-banana tabular-nums">{refHistory.length}</div>
            <div className="text-text-muted text-xs mt-1">Friends Joined</div>
          </div>
          <div className="text-center border-l border-bg-elevated">
            <div className="text-2xl font-bold text-banana tabular-nums">{refRewardsEarned}</div>
            <div className="text-text-muted text-xs mt-1">Spins Earned Here</div>
          </div>
        </div>

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

        {/* Referral History — empty state keeps the section visible so the
            modal structure matches every other promo. */}
        {(!promo.modalContent.referralHistory || promo.modalContent.referralHistory.length === 0) && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Referral History</h4>
            <p className="text-text-muted text-sm">Friends who join with your link land here with their progress.</p>
          </div>
        )}
        {promo.modalContent.referralHistory && promo.modalContent.referralHistory.length > 0 && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            <h4 className="font-semibold mb-3 text-text-primary">Referral History</h4>
            <div className="space-y-4 max-h-56 overflow-y-auto scrollbar-hover pr-3">
              {[...promo.modalContent.referralHistory].sort((a, b) => {
                // Sort by reward status: claim first, pending second, claimed last
                const getOrder = (entry: typeof a) => {
                  if (!entry.rewards) return 2;
                  const statuses = [entry.rewards.verified, entry.rewards.bought1, entry.rewards.bought4, entry.rewards.bought10];
                  if (statuses.some(s => s === 'claim')) return 0;
                  if (statuses.some(s => s === 'pending')) return 1;
                  return 2;
                };
                return getOrder(a) - getOrder(b);
              }).map((entry, index) => (
                <div key={index} className="border-b border-bg-elevated last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    {(() => {
                      const live = entry.referredUserId ? referralUsers[entry.referredUserId.toLowerCase()] : undefined;
                      const name = live?.displayName || entry.username;
                      const pfp = live?.imageUrl || '/banana-profile.png';
                      return (
                        <UserPopover walletAddress={entry.referredUserId ?? ''} username={name} pfpUrl={pfp}>
                          <div className="flex items-center gap-2.5 cursor-pointer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={pfp} alt="" className="w-8 h-8 rounded-full object-cover flex-none" />
                            <div>
                              <p className="text-text-primary font-medium">{name}</p>
                              <p className="text-text-muted text-xs">{entry.dateJoined}</p>
                            </div>
                          </div>
                        </UserPopover>
                      );
                    })()}
                    {entry.draftsPurchased !== undefined && (
                      <span className="text-text-muted text-xs">{Math.min(entry.draftsPurchased, 10)} Draft Passes</span>
                    )}
                  </div>
                  {/* Verify gate as a milestone-style row: label left, status
                      box right — Pending flips to a green check in realtime
                      (promos refetch on the stream ping when it happens). */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-text-secondary text-xs">
                      Verified X &amp; Spun Free Spin
                      {entry.verifiedAt ? <span className="text-text-muted"> · {fmtWhen(entry.verifiedAt)}</span> : null}
                    </span>
                    {entry.rewards?.verified === 'claimed' ? (
                      <span className="w-16 py-1 rounded text-[10px] font-medium text-center bg-success/20 text-success">✓ Done</span>
                    ) : (
                      <span className="w-16 py-1 rounded text-[10px] font-medium text-center bg-bg-elevated text-text-muted">Pending</span>
                    )}
                  </div>
                  {entry.rewards && (
                    <div className="flex gap-3 mt-2 justify-end">
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">Bought 1</span>
                        {getRewardBadge(entry.rewards.bought1, 'Bought 1', entry.username)}
                        {entry.milestoneDates?.bought1 && (
                          <span className="text-[8px] text-text-muted">{fmtWhen(entry.milestoneDates.bought1)}</span>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">4 Total</span>
                        {getRewardBadge(entry.rewards.bought4 ?? 'pending', '4 Total', entry.username)}
                        {entry.milestoneDates?.bought4 && (
                          <span className="text-[8px] text-text-muted">{fmtWhen(entry.milestoneDates.bought4)}</span>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 w-16">
                        <span className="text-[8px] text-text-muted">10 Total</span>
                        {getRewardBadge(entry.rewards.bought10, '10 Total', entry.username)}
                        {entry.milestoneDates?.bought10 && (
                          <span className="text-[8px] text-text-muted">{fmtWhen(entry.milestoneDates.bought10)}</span>
                        )}
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

  // ── Banana Draw ───────────────────────────────────────────────────────
  // Order is deliberate (Boris 2026-07-26): the MECHANIC in one line, then how
  // to earn, then their own numbers, then everything else. The generic bullet
  // list is suppressed for this promo (see pickExplanation) — it printed the
  // same rules a second time and buried the point under a wall of text.
  /**
   * THE ELIMINATOR — the modal explains the mechanic, but the thing people
   * actually want after reading it is the live board. Without this button the
   * only route there is closing the modal and scrolling, which on the home
   * carousel means navigating to /promos by hand (Richard 2026-07-31).
   */
  const renderEliminatorContent = () => (
    <div className="bg-bg-tertiary rounded-xl p-4 text-center">
      <p className="text-text-secondary text-sm mb-3">
        See who&apos;s surviving right now and how far you are from a seat.
      </p>
      <Button
        className="w-full"
        onClick={() => { onClose(); window.location.href = '/promos#eliminator-board'; }}
      >
        View the Leaderboard
      </Button>
    </div>
  );

  const renderBananaDrawContent = () => {
    const bd = promo.modalContent.bananaDraw;
    if (!bd) return null;
    const lastWin = bd.recentWinners[0];

    // One earning row. Count is shown only once they have some, so a new user
    // reads a clean rate card instead of a column of zeros.
    const earn = (label: string, bananas: number, count: number) => (
      <div key={label} className="flex items-center justify-between py-2">
        <span className="text-text-secondary text-sm">{label}</span>
        <span className="flex items-center gap-3">
          {count > 0 && <span className="text-text-muted text-xs tabular-nums">{count} so far</span>}
          <span className="text-banana font-bold tabular-nums">{bananas} 🍌</span>
        </span>
      </div>
    );

    return (
      <>
        {/* 1 — THE MECHANIC. Two lines, nothing else. */}
        <div className="text-center py-1">
          <p className="text-text-primary text-base font-semibold leading-snug">
            Every 24 hours, one player wins a seat in the<br />
            first ever <JackHofWordmark size={16} /> draft.
          </p>
          <p className="text-text-muted text-sm mt-1.5">
            More Bananas, better odds — but all it takes is one.
          </p>
        </div>

        {/* 2 — HOW YOU EARN. The rate card, straight after the mechanic. */}
        <div className="bg-bg-tertiary rounded-xl px-4 py-3">
          <div className="divide-y divide-white/5">
            {earn('Free draft — once it fills', 1, bd.freeDrafts)}
            {earn('Paid draft — once it fills', 2, bd.paidDrafts)}
            {earn('A friend you invited drafts', 5, bd.referrals)}
            {earn('…and when they buy passes', 5, 0)}
          </div>
          <p className="text-text-muted text-xs mt-2.5 pt-2.5 border-t border-white/5">
            Bananas reset every 24 hours — use your drafts.
          </p>
        </div>

        {/* 3 — YOUR POSITION. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          {/* Odds callout removed (Boris 2026-07-26) — the leaderboard already
              shows each player's share, so a second percentage here was noise. */}
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-banana tabular-nums">{bd.bananas} 🍌</span>
            <span className="text-text-muted text-xs">this cycle</span>
          </div>
          {bd.pending > 0 && (
            <p className="text-text-muted text-xs mt-2">
              {bd.pending} {bd.pending === 1 ? 'draft' : 'drafts'} filling — {bd.pending === 1 ? 'that Banana lands' : 'those Bananas land'} when {bd.pending === 1 ? 'it fills' : 'they fill'}.
            </p>
          )}
          {bd.totalBananas > 0 && (
            <p className="text-text-secondary text-sm mt-2">
              {bd.totalBananas} Bananas in this draw from {bd.entrantCount} {bd.entrantCount === 1 ? 'player' : 'players'}.
            </p>
          )}
        </div>

        {/* 4 — THE PRIZE + seats. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-text-primary font-medium">
              First ever <JackHofWordmark size={13} /> draft
            </span>
            <span className="text-text-muted text-xs tabular-nums">{bd.seatsClaimed} of {bd.seatsTotal} seats</span>
          </div>
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden mb-2">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (bd.seatsClaimed / (bd.seatsTotal || 10)) * 100)}%`,
                       background: 'linear-gradient(90deg,#ef4444,#D4AF37)' }} />
          </div>
          <p className="text-text-secondary text-sm">
            Jackpot + Hall of Fame on ONE roster — win your league and skip straight
            to the finals, AND compete for HOF prizes. When all {bd.seatsTotal} seats are
            claimed, it drafts.
          </p>
        </div>

        {/* 5 — LEADERBOARD, by share not rank. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Current leaderboard</h4>
          {bd.leaderboard.length === 0 ? (
            <p className="text-text-muted text-sm">
              Nobody has earned a Banana yet this cycle. Fill a draft and you&apos;re first on the board.
            </p>
          ) : (
            <div className="space-y-1">
              {bd.leaderboard.slice(0, 10).map((r, i) => (
                <div key={`${r.name}-${i}`}
                  className={`flex items-center justify-between text-sm py-1 ${r.isYou ? 'text-banana font-semibold' : 'text-text-secondary'}`}>
                  <span className="truncate mr-3">
                    <span className="text-text-muted mr-2 tabular-nums">{i + 1}</span>
                    {r.isYou ? 'You' : r.name}
                  </span>
                  <span className="shrink-0 tabular-nums">{r.bananas} 🍌</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 7 — The rest. Deliberately last: true, but not what you open for. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-2 text-text-primary">Good to know</h4>
          <p className="whitespace-pre-line text-text-secondary text-sm leading-relaxed">
            {'• Provably fair — the random number is sealed before the clock runs out and published after, so anyone can check the draw.\n'
            + '• Win twice? Your second seat goes into the NEXT JackHOF league — we don’t redraw. The first draft keeps filling until 10 DIFFERENT players are in.\n'
            + '• Your seat is a slow draft. You can sell it on the marketplace until the draft fills.\n'
            + '• One account per person — more than one account makes you ineligible to win prizes.\n'
            + '• Real players only: the friends you refer must actually play fantasy football. Referring people who don’t makes BOTH you and your referral ineligible to win prizes.'}
          </p>
        </div>

        {/* 8 — All-time history. */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Your Banana history</h4>
          {bd.allTime.length === 0 ? (
            <p className="text-text-muted text-sm">
              Every Banana you earn lands here with the date and where it came from — your drafts, and friends you invite.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {bd.allTime.map((h, i) => (
                <div key={`${h.at}-${i}`} className="flex justify-between text-sm py-0.5">
                  <span className="text-text-secondary">{BANANA_SOURCE_LABEL[h.source] ?? h.source}</span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <span className="text-text-muted text-xs">{h.at.slice(5, 10)}</span>
                    <span className="text-banana">{h.bananas} 🍌</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 9 — The draw ceremony, LAST (Boris 2026-07-27). It used to sit
            mid-modal, where a reel captioned "Drawing from the sealed
            number…" read as a draw happening RIGHT NOW — mid-cycle, hours
            after the number was actually drawn ("its pretending to do it").
            Down here, under the history, framed as "Seat N winner", the same
            animation reads as what it is: the replay of a finished draw.
            Entrants who got the result bell land in this modal and can watch
            it play out; the winner is server-decided either way. */}
        {lastWin && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            {/* EVERY seat winner, oldest first — not just the latest (Boris
                2026-07-28: "show both their names"). The reveal below still
                replays the most recent draw. */}
            <div className="mb-2 space-y-0.5">
              {[...bd.recentWinners].reverse().map((w, i, arr) => {
                const n = Math.max(1, bd.seatsClaimed - (arr.length - 1 - i));
                const v = n % 100;
                const suf = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] ?? 'th';
                return (
                  <h4 key={w.cycleId} className="font-semibold text-text-primary">
                    {n}{suf} Seat — {w.name}
                  </h4>
                );
              })}
            </div>
            <BananaDrawReveal
              entrants={bd.lastDrawEntrants?.length
                ? bd.lastDrawEntrants
                : bd.leaderboard.map((r) => (r.isYou ? 'You' : r.name))}
              winnerName={lastWin.name}
              winnerBananas={lastWin.bananas}
            />
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
            entries={jpEntries?.map((e) => {
              const live = jpEntryUsers[e.wallet.toLowerCase()];
              return {
                name: live?.displayName || e.name,
                slot: e.slot,
                pfp: live?.imageUrl || null,
              };
            })}
            winnerLabel={jpWinnerLabel ?? undefined}
            winnerIdxOverride={jpWinnerIdx}
            onSettled={() => setJpRevealSettled(true)}
          />
          {jpRevealSettled && (jpVrf?.receiptTxHash || jpVrf?.saltHash || jpSeedBasis) && (
            <div className="bg-bg-tertiary/60 rounded-lg px-3 py-2 space-y-1">
              <p className="text-text-muted text-[10px] text-center">
                Provably fair ✓ — drawn from VRF randomness sealed on-chain before this draft existed
                {typeof jpVrf?.period === 'number' ? ` (period ${jpVrf.period})` : ''}.
              </p>
              {jpVrf?.receiptTxHash && (
                <p className="text-[10px] text-center">
                  <a
                    href={`https://basescan.org/tx/${jpVrf.receiptTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-banana hover:underline"
                  >
                    View on-chain draw receipt →
                  </a>
                </p>
              )}
            </div>
          )}
          {jpRevealError && (
            <p className="text-text-muted text-xs text-center">
              Couldn&apos;t load drafter names — animation falls back to position labels.
            </p>
          )}
        </>
      );
    }

    const totalJackpots = history?.length ?? 0;
    const totalJpSpins = (history ?? []).reduce((s, e) => s + (e.amount || 0), 0);

    const cycle = promo.modalContent.cycle;
    const latest = promo.modalContent.latestDraw;
    return (
      <>
        {renderProgressSection()}
        {/* LIVE cycle tracker — real draft counter, same number the award
            logic reads; refreshed on every stream ping. */}
        {cycle && (
          <div className="bg-bg-tertiary rounded-xl p-4">
            {/* Position only — the global draft number (#2,6xx) read as a
                second, unrelated counter next to it and just confused people
                (Boris 2026-07-25). What matters is where the cycle stands. */}
            <div className="mb-2">
              <span className="text-text-primary font-medium">{cycle.position} of {cycle.windowLength} this cycle</span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-jackpot rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (cycle.position / (cycle.windowLength || 100)) * 100)}%` }}
              />
            </div>
            <p className="text-text-secondary text-sm">
              {cycle.tenLeft > 0
                ? `${cycle.tenLeft} ${cycle.tenLeft === 1 ? 'draft' : 'drafts'} left where a Jackpot hit pays 10 Free Spins — up to 200 free drafts.`
                : cycle.fiveLeft > 0
                ? `${cycle.fiveLeft} ${cycle.fiveLeft === 1 ? 'draft' : 'drafts'} left where a Jackpot hit pays 5 Free Spins — up to 100 free drafts.`
                : 'Bonus windows are closed for this cycle. The moment this cycle’s Jackpot lands, a fresh cycle opens and the 10-Spin window is live again.'}
            </p>
            {latest && (
              <p className="text-text-muted text-xs mt-2">
                Latest winner: <span className="text-jackpot font-medium">{latest.winnerName}</span> · {latest.draftName} · {fmtWhen(latest.atIso)} · {latest.reward} spins
              </p>
            )}
          </div>
        )}
        {/* Live cumulative stats — Jackpots landed + spins they earned. */}
        <div className="bg-bg-tertiary rounded-xl p-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-jackpot tabular-nums">{totalJackpots}</div>
            <div className="text-text-muted text-xs mt-1">Jackpots Hit</div>
          </div>
          <div className="text-center border-l border-bg-elevated">
            <div className="text-2xl font-bold text-banana tabular-nums">{totalJpSpins}</div>
            <div className="text-text-muted text-xs mt-1">Spins Earned Here</div>
          </div>
        </div>
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Jackpot Wins</h4>
          {hasHistory ? (
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {history!.map((entry, index) => (
                <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                  <div>
                    <p className="text-text-secondary text-sm">{entry.draftName}</p>
                    <p className="text-text-muted text-xs">{fmtWhen(entry.date)}</p>
                  </div>
                  <span className="text-jackpot font-semibold">{entry.amount} {entry.amount === 1 ? 'spin' : 'spins'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">Every Jackpot draft you land lands here with the draft and date.</p>
          )}
        </div>
      </>
    );
  };

  const renderFounderDraftContent = () => {
    const history = promo.modalContent.founderHistory;
    const hasHistory = history && history.length > 0;
    return (
      <>
        {renderProgressSection()}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Founder Drafts Joined</h4>
          {hasHistory ? (
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {history!.map((entry, index) => (
                <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                  <div>
                    <p className="text-text-secondary text-sm">{entry.draftName}</p>
                    <p className="text-text-muted text-xs">{fmtWhen(entry.date)}</p>
                  </div>
                  <span className="font-semibold" style={{ color: '#06b6d4' }}>
                    {entry.amount} {entry.amount === 1 ? 'free spin' : 'free spins'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">Founder Drafts you join land here with the date.</p>
          )}
        </div>
      </>
    );
  };

  const renderMintContent = () => {
    const mintHistory = promo.modalContent.mintHistory ?? [];
    const totalMinted = promo.modalContent.totalMinted ?? 0;
    return (
      <>
        {renderProgressSection()}
        {/* Live cumulative stats — same two-tile shape as the other promos. */}
        <div className="bg-bg-tertiary rounded-xl p-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-banana tabular-nums">{totalMinted}</div>
            <div className="text-text-muted text-xs mt-1">Passes Purchased All-Time</div>
          </div>
          <div className="text-center border-l border-bg-elevated">
            <div className="text-2xl font-bold text-banana tabular-nums">{Math.floor(totalMinted / 10)}</div>
            <div className="text-text-muted text-xs mt-1">Spins Earned Here</div>
          </div>
        </div>
        {/* Purchase history — newest first. Always rendered (empty state when
            the account predates per-purchase tracking, 2026-06-10). */}
        <div className="bg-bg-tertiary rounded-xl p-4">
          <h4 className="font-semibold mb-3 text-text-primary">Purchase History</h4>
          {mintHistory.length > 0 ? (
            <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-hover pr-3">
              {mintHistory.map((entry, index) => (
                <div key={index} className="flex justify-between py-2 border-b border-bg-elevated last:border-0">
                  <span className="text-text-secondary text-sm">{fmtWhen(entry.date)}</span>
                  <span className="text-banana font-medium text-sm">+{entry.quantity} {entry.quantity === 1 ? 'pass' : 'passes'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">Each purchase lands here with its date and pass count.</p>
          )}
        </div>
      </>
    );
  };

  const renderNewUserContent = () => {
    if (!isLoggedIn) {
      return (
        <div className="bg-bg-tertiary rounded-xl p-4 text-center">
          <p className="text-text-secondary mb-3">Sign in to verify your Twitter/X and claim your Free Spin.</p>
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
              <p className="text-sm font-bold text-error mt-1 leading-snug">⚠️ {twitterError}</p>
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
      <p className="font-semibold mb-2 text-text-primary">July 4th Weekend Only!</p>
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
        // onVerifyTweet returned null — the X API call or post-verify
        // write failed inside usePromos. Surface it so the admin Logs
        // tab catches verification outages.
        reportClientError({
          source: LOG_SOURCES.promo.TWEET_VERIFY_FAILED,
          message: 'verifyTweetEngagement returned null',
          route: 'promos',
          context: { promoId: promo.id, promoType: promo.type, xHandle: user?.xHandle },
        });
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
      case 'founder-draft':
        return renderFounderDraftContent();
      case 'mint':
        return renderMintContent();
      case 'new-user':
        return renderNewUserContent();
      case 'buy-bonus':
        return renderBuyBonusContent();
      case 'tweet-engagement':
        return renderTweetEngagementContent();
      case 'pick-chase':
        return renderChaseContent();
      case 'banana-draw':
        return renderBananaDrawContent();
      case 'eliminator':
        return renderEliminatorContent();
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
  const canClaim = !jpSpectating && baseCanClaim && (promo.type !== 'jackpot' || !jpRevealing || jpRevealSettled);
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
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
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
                pickExplanation
              )}
            </p>
          </div>
        </div>

        {/* Dynamic Content Based on Promo Type */}
        {renderPromoContent()}

        {/* Claim Button */}
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
      </div>

      {/* Claim Success Popup */}
      {claimSuccess.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-bg-secondary rounded-2xl p-6 w-80 text-center shadow-2xl">
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="text-xl font-bold text-text-primary mb-2">Success!</h3>
            <p className="text-text-secondary mb-6">
              {promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft'
                ? `You got ${claimSuccess.count} free ${claimSuccess.count === 1 ? 'draft' : 'drafts'}!`
                : `You got ${claimSuccess.count} free ${claimSuccess.count === 1 ? 'spin' : 'spins'}!`}
            </p>
            <div className="flex flex-col gap-3">
              {promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft' ? (
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
    </>
  );
}
