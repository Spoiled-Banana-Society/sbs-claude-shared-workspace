'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { FounderTag } from '@/components/drafting/FounderTag';
import { getDraftTypeColor } from '@/lib/draftTypes';
import { useLeagueNumberForSlot } from '@/hooks/useLeagueNumberForSlot';
import { useIsFounderDraft } from '@/hooks/useIsFounderDraft';
import { slowDraftActiveSecondsUntil, isSlowDraftNightPause } from '@/utils/slowDraftClock';
import type { DraftState } from '@/lib/draftStore';

export type Draft = DraftState;

export type LiveState = {
  displayPhase: 'filling' | 'randomizing' | 'pre-spin-countdown' | 'draft-starting' | 'drafting';
  playerCount: number;
  countdown: number | null;
  randomizingProgress: number | null;
  isFilling: boolean;
};

interface DraftRowProps {
  draft: Draft;
  live: LiveState;
  isCreating: boolean;
  onDraftClick: (draft: Draft) => void;
  onExitDraft?: (draft: Draft) => void;
  formatRelativeTime: (timestamp: number) => string;
  formatCountdown: (seconds: number) => string;
}

export function DraftRow({
  draft,
  live,
  isCreating,
  onDraftClick,
  onExitDraft,
  formatRelativeTime,
  formatCountdown,
}: DraftRowProps) {
  const resolvedType = draft.type || draft.draftType || draft.specialType || null;
  const isRevealed = resolvedType !== null;
  const isFounder = useIsFounderDraft(draft.id);
  const accentColor = isRevealed ? getDraftTypeColor(resolvedType) : '#888';
  // Live-resolved global league number — single source of truth from
  // the doc's DisplayName via /api/drafts/{slotId}/league-number.
  // Used both for the badge URL AND the displayed row label so a
  // stale/wrong contestName (e.g. backend fallback that extracts the
  // slot number from the id) can't show the wrong league number.
  const liveLeagueNumber = useLeagueNumberForSlot(draft.id);
  // Detect a contestName that was derived from the slot number — older
  // builds wrote "League #${slot}" into localStorage even though the
  // slot counter drifts from the global league number. Showing that
  // stale value would lie about the league number for the brief window
  // before useLeagueNumberForSlot resolves. Render "League…" instead.
  const slotMatch = /-draft-(\d+)$/.exec(draft.id || '');
  const looksLikeSlotFallback = !!slotMatch && (
    draft.contestName === `League #${slotMatch[1]}` ||
    draft.contestName === `BBB League #${slotMatch[1]}` ||
    draft.contestName === `BBB #${slotMatch[1]}`
  );
  const displayedLeagueName = liveLeagueNumber != null
    ? `League #${liveLeagueNumber}`
    : (looksLikeSlotFallback || !draft.contestName)
      ? 'League…'
      : draft.contestName;
  // Render-time diagnostic — only log on meaningful changes (not every
  // render). Tracks which branch picked the final displayed value so we
  // can trace any "stale league #" report end-to-end.
  const lastLoggedRef = React.useRef<string>('');
  React.useEffect(() => {
    const key = `${liveLeagueNumber}|${draft.contestName}|${displayedLeagueName}`;
    if (lastLoggedRef.current === key) return;
    lastLoggedRef.current = key;
    void import('@/lib/clientLog').then(m => m.clientLog('league#', 'DraftRow.render', {
      slotId: draft.id,
      liveLeagueNumber,
      contestName: draft.contestName,
      looksLikeSlotFallback,
      displayedLeagueName,
    })).catch(() => {});
  }, [draft.id, liveLeagueNumber, draft.contestName, looksLikeSlotFallback, displayedLeagueName]);
  // Reveal-state diagnostic — confirms the type-gate never shows a type
  // before the actual draft reveal. Logs only on meaningful change.
  const lastRevealLogRef = React.useRef<string>('');
  React.useEffect(() => {
    const type = draft.type || draft.draftType || draft.specialType || null;
    const key = `${live.displayPhase}|${live.playerCount}|${live.countdown}|${type}`;
    if (lastRevealLogRef.current === key) return;
    lastRevealLogRef.current = key;
    void import('@/lib/clientLog').then(m => m.clientLog('type-reveal', 'DraftRow.gate', {
      slotId: draft.id,
      displayPhase: live.displayPhase,
      playerCount: live.playerCount,
      countdown: live.countdown,
      resolvedType: type,
      enginePickNumber: draft.enginePickNumber ?? null,
    })).catch(() => {});
  }, [draft.id, live.displayPhase, live.playerCount, live.countdown, draft.type, draft.draftType, draft.specialType, draft.enginePickNumber]);
  const isYourTurn = draft.isYourTurn;
  const isSpecial = !!draft.specialType;
  // Wheel-won drafts know their tier up front, so label them clearly instead of
  // the generic "Draft Room" (filling) / "League #N" (filled). Regular drafts
  // keep "Draft Room" while filling — their tier is hidden until the slot reveal.
  const wheelLabel = draft.specialType === 'jackpot'
    ? 'Jackpot (from Wheel)'
    : draft.specialType === 'hof'
      ? 'HOF (from Wheel)'
      : null;
  const effectiveLive = isSpecial && live.displayPhase === 'pre-spin-countdown'
    ? { ...live, displayPhase: 'draft-starting' as const, countdown: live.countdown != null ? live.countdown + 45 : null }
    : live;

  return (
    <div
      onClick={() => onDraftClick(draft)}
      className={`group cursor-pointer transition-all overflow-hidden rounded-xl hover:bg-white/[0.04] border ${
        isYourTurn ? 'border-banana bg-banana/10' : isCreating ? 'border-banana/50 bg-banana/5' : 'border-white/[0.08] bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center justify-between px-3 sm:px-5 py-3">
        <div className="sm:w-28 flex-shrink-0 flex items-center gap-1">
          {draft.joinedAt ? (
            <Tooltip content={`Joined ${formatRelativeTime(draft.joinedAt)}`}>
              <span className="text-white/80 font-medium cursor-default whitespace-nowrap text-xs sm:text-base">{wheelLabel ?? (effectiveLive.isFilling ? 'Draft Lobby' : displayedLeagueName)}</span>
            </Tooltip>
          ) : (
            <span className="text-white/80 font-medium whitespace-nowrap text-xs sm:text-base">{wheelLabel ?? (effectiveLive.isFilling ? 'Draft Lobby' : displayedLeagueName)}</span>
          )}
          {draft.airplaneMode && (!isSpecial || draft.status === 'drafting') && (
            <Tooltip content="Auto-pick enabled">
              <span className="text-xs sm:text-sm">✈️</span>
            </Tooltip>
          )}
        </div>

        {/* Speed column — abbreviated on mobile ("30s" / "8h"). Hidden on mobile
            for Founder rows to give the FOUNDER tag room. */}
        <div className={`sm:w-16 flex-shrink-0 text-center ${isFounder ? 'hidden sm:block' : ''}`}>
          {effectiveLive.displayPhase === 'drafting' && draft.draftSpeed !== 'fast' && isSlowDraftNightPause(Math.floor(Date.now() / 1000)) ? (
            // Overnight pause (10pm–5am PT): the whole slow draft is frozen, so
            // show the pause state on EVERY in-progress slow row (not just when
            // it's your turn). The status column still shows your time / picks away.
            <span className="text-banana/80 text-[10px] sm:text-xs font-medium whitespace-nowrap" title="Slow-draft clock pauses 10pm–5am PT — resumes 5am PT">
              <span className="sm:hidden">⏸</span>
              <span className="hidden sm:inline">⏸ Paused</span>
            </span>
          ) : (
            <span className="text-white/50 text-xs sm:text-sm whitespace-nowrap">
              <span className="sm:hidden">{draft.draftSpeed === 'fast' ? '30s' : '8h'}</span>
              <span className="hidden sm:inline">{draft.draftSpeed === 'fast' ? '30 sec' : '8 hour'}</span>
            </span>
          )}
        </div>

        {/* Draft type column (PRO / HOF / JACKPOT + Verified badge).
            Mobile: type label + an icon-only Verified badge (compact)
            — the "Verified" word is dropped on phones since the green
            check + colored type already communicates it, and the word
            crams the 5-column row. Desktop: full badge with the word. */}
        <div className="sm:w-28 flex-shrink-0 flex items-center justify-center gap-1 sm:gap-1.5">
          {!isSpecial && (effectiveLive.displayPhase === 'randomizing' || effectiveLive.displayPhase === 'pre-spin-countdown' || (effectiveLive.displayPhase === 'draft-starting' && effectiveLive.countdown != null && effectiveLive.countdown > 37) || (effectiveLive.displayPhase === 'filling' && effectiveLive.playerCount >= 10)) ? (
            <span className="text-banana text-[10px] sm:text-sm font-semibold animate-pulse">Revealing...</span>
          ) : isRevealed ? (
            // Type + verified always show (PRO/HOF/JP stays visible even on a
            // Founder row). On mobile we make room for the FOUNDER tag by hiding
            // the round/pick column instead (see below).
            <span className="flex items-center gap-1 sm:gap-1.5">
              <span className="text-[11px] sm:text-sm font-semibold whitespace-nowrap" style={{ color: accentColor }}>
                <span className="sm:hidden">{resolvedType === 'jackpot' ? 'JP' : resolvedType === 'hof' ? 'HOF' : 'PRO'}</span>
                <span className="hidden sm:inline">{resolvedType === 'jackpot' ? 'JACKPOT' : resolvedType === 'hof' ? 'HALL OF FAME' : 'PRO'}</span>
              </span>
              {/* Prefer the live-resolved global league number for the
                  badge URL. Falls back to the slot id (which the proof
                  page itself can resolve) while the API call is in
                  flight. Queue drafts (no slot pattern) get a
                  non-interactive badge. */}
              {(() => {
                const isLeagueSlot = /^\d{4}-(fast|slow)-draft-\d+$/.test(draft.id);
                const linkTarget = !isLeagueSlot
                  ? undefined
                  : (liveLeagueNumber != null ? String(liveLeagueNumber) : draft.id);
                return (
                  <>
                    {/* mobile — icon-only */}
                    <span className="sm:hidden inline-flex">
                      <VerifiedBadge type="draft-type" draftType={resolvedType} size="sm" compact draftId={linkTarget} />
                    </span>
                    {/* desktop — full badge with "Verified" word */}
                    <span className="hidden sm:inline-flex">
                      <VerifiedBadge type="draft-type" draftType={resolvedType} size="sm" draftId={linkTarget} />
                    </span>
                  </>
                );
              })()}
            </span>
          ) : (
            <span className="text-white/30 text-[10px] sm:text-sm italic">Unrevealed</span>
          )}
          {isFounder && <FounderTag size="sm" />}
        </div>

        {/* Pick / Round column — only meaningful once the draft is actively
            picking. Stays empty (dash) for filling / pre-spin / randomizing
            so the column width is reserved and rows stay aligned. On MOBILE we
            hide it for Founder rows to make room for the FOUNDER tag. */}
        <div className={`sm:w-24 flex-shrink-0 ${isFounder ? 'hidden sm:flex' : 'flex'} items-center justify-center`}>
          {effectiveLive.displayPhase === 'drafting' && draft.enginePickNumber && draft.enginePickNumber > 0 ? (
            <span className="text-white/60 text-[11px] sm:text-sm whitespace-nowrap tabular-nums">
              R{Math.ceil(draft.enginePickNumber / 10)} P{draft.enginePickNumber}
            </span>
          ) : (
            <span className="text-white/20 text-[11px] sm:text-sm">—</span>
          )}
        </div>

        <div className="sm:w-28 flex-shrink-0 flex items-center justify-center">
          {effectiveLive.displayPhase === 'filling' ? (
            <span className="text-xs sm:text-sm tabular-nums">
              <span className="text-white font-semibold">{effectiveLive.playerCount}</span>
              <span className="text-white/40">/10</span>
            </span>
          ) : effectiveLive.displayPhase === 'randomizing' ? (
            <div className="flex flex-col items-center gap-1">
              <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round((effectiveLive.randomizingProgress ?? 0) * 100)}%`,
                    background: (effectiveLive.randomizingProgress ?? 0) >= 0.99
                      ? '#4ade80'
                      : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                  }}
                />
              </div>
              <span className="text-white/40 text-[10px]">Randomizing...</span>
            </div>
          ) : effectiveLive.displayPhase === 'pre-spin-countdown' ? (
            <span className="text-white/50 text-[11px] sm:text-sm whitespace-nowrap">Reveal in {effectiveLive.countdown}s</span>
          ) : effectiveLive.displayPhase === 'draft-starting' ? (
            <span className="text-white/50 text-[11px] sm:text-sm whitespace-nowrap">
              {effectiveLive.countdown != null ? `Starts in ${effectiveLive.countdown}s` : 'Starting...'}
            </span>
          ) : isYourTurn ? (
            (() => {
              // Suppress the brief on-mount flash of an un-confirmed
              // countdown. If the "remaining" implied by the stored
              // pickEndTimestamp is within 5% of the full pickLength for
              // this speed, the value is almost certainly a pre-sync
              // default that syncLiveDrafts will overwrite on its next
              // poll (<= 3s). Render a quiet placeholder until then.
              // SLOW picks pause overnight (10pm–5am PT), so the raw
              // pickEndTimestamp − now includes the skipped paused hours and
              // reads as a huge ~27000s+ value → it would wrongly stick on
              // "Syncing…". Use the pause-aware remaining for slow (matches the
              // in-room clock); fast stays raw wall-clock.
              const nowSec = Math.floor(Date.now() / 1000);
              const isSlow = draft.draftSpeed !== 'fast';
              // During the overnight pause we STILL show the time remaining here
              // (the pause state shows in the speed column). For slow,
              // slowDraftActiveSecondsUntil returns the active budget, which
              // doesn't tick down while paused — so the clock simply freezes.
              const remaining = draft.pickEndTimestamp
                ? (isSlow
                    ? slowDraftActiveSecondsUntil(nowSec, draft.pickEndTimestamp)
                    : Math.max(0, draft.pickEndTimestamp - nowSec))
                : (draft.timeRemaining ?? 30);
              const expectedPickLength = isSlow ? 28800 : 30;
              // Fast: a value within 5% of full is almost certainly a pre-sync
              // default → brief placeholder. Slow: an 8h pick legitimately sits
              // near-full for ~24min, so 5% would falsely read "Syncing…"; only
              // a value ABOVE the max pick length (raw/unsynced) is unconfirmed.
              const looksUnconfirmed = isSlow
                ? remaining > expectedPickLength + 2
                : remaining > expectedPickLength * 0.95;
              if (looksUnconfirmed) {
                return <span className="text-white/30 text-[11px] sm:text-sm">Syncing…</span>;
              }
              return (
                <span className="text-banana font-bold text-sm sm:text-base">
                  {formatCountdown(remaining)}
                </span>
              );
            })()
          ) : draft.currentPick != null ? (
            <span className="text-white/50 text-[11px] sm:text-sm whitespace-nowrap">
              {/* currentPick semantics:
                  > 0  → that many picks away
                  = 0  → either your turn OR you have no more picks
                  When currentPick === 0 AND the draft is past pick 1,
                  it's "you're done" (your isYourTurn would be true
                  otherwise). Show "Picks complete" instead of the
                  misleading "Next up". */}
              {draft.currentPick === 0
                ? (draft.isYourTurn ? 'Next up' : 'Picks complete')
                : `${draft.currentPick} pick${draft.currentPick !== 1 ? 's' : ''} away`}
            </span>
          ) : (
            <span className="text-white/50 text-[11px] sm:text-sm">In progress</span>
          )}
        </div>

        <div className="sm:w-28 flex-shrink-0 flex items-center justify-end gap-1 sm:gap-2">
          {['filling', 'randomizing', 'pre-spin-countdown', 'draft-starting'].includes(effectiveLive.displayPhase) ? (
            <>
              <Tooltip content="Enter draft room">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDraftClick(draft);
                  }}
                  className="w-[52px] sm:w-20 py-1.5 sm:py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all hover:scale-105 bg-white text-black hover:bg-white/90 flex items-center justify-center"
                >
                  {isCreating ? 'Joining...' : 'Enter'}
                </button>
              </Tooltip>
              {effectiveLive.displayPhase === 'filling' && onExitDraft && !isSpecial && (
                <Tooltip content="Leave draft">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExitDraft(draft);
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDraftClick(draft);
              }}
              className="w-[52px] sm:w-20 py-1.5 sm:py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all hover:scale-105 flex items-center justify-center whitespace-nowrap"
              style={{
                backgroundColor: isYourTurn ? '#fbbf24' : accentColor,
                color: isYourTurn ? '#000' : '#fff',
              }}
            >
              {isYourTurn ? (
                <>
                  {/* "Pick Now" overflows the 52px mobile box — shorten to
                      "Pick" on mobile, keep the fuller label on sm+. */}
                  <span className="sm:hidden">Pick</span>
                  <span className="hidden sm:inline">Pick Now</span>
                </>
              ) : (
                'Enter'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
