'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { FounderPill } from '@/components/drafting/FounderPill';
import { getDraftTypeColor } from '@/lib/draftTypes';
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
  const accentColor = isRevealed ? getDraftTypeColor(resolvedType) : '#888';
  const isYourTurn = draft.isYourTurn;
  const isSpecial = !!draft.specialType;
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
      <div className="flex items-center justify-between px-5 py-3">
        <div className="w-28 flex-shrink-0 flex items-center gap-1">
          {draft.joinedAt ? (
            <Tooltip content={`Joined ${formatRelativeTime(draft.joinedAt)}`}>
              <span className="text-white/80 font-medium cursor-default whitespace-nowrap">{effectiveLive.isFilling ? 'Draft Room' : draft.contestName}</span>
            </Tooltip>
          ) : (
            <span className="text-white/80 font-medium whitespace-nowrap">{effectiveLive.isFilling ? 'Draft Room' : draft.contestName}</span>
          )}
          {draft.airplaneMode && (!isSpecial || draft.status === 'drafting') && (
            <Tooltip content="Auto-pick enabled">
              <span className="text-sm">✈️</span>
            </Tooltip>
          )}
        </div>

        <div className="w-16 flex-shrink-0 text-center hidden sm:block">
          <span className="text-white/50 text-sm">{draft.draftSpeed === 'fast' ? '30 sec' : '8 hour'}</span>
        </div>

        <div className="w-28 flex-shrink-0 hidden sm:flex items-center justify-center gap-1.5">
          {!isSpecial && (effectiveLive.displayPhase === 'randomizing' || effectiveLive.displayPhase === 'pre-spin-countdown' || (effectiveLive.displayPhase === 'draft-starting' && effectiveLive.countdown != null && effectiveLive.countdown > 37)) ? (
            <span className="text-banana text-sm font-semibold animate-pulse">Revealing...</span>
          ) : isRevealed ? (
            <>
              <span className="text-sm font-semibold" style={{ color: accentColor }}>
                {resolvedType === 'jackpot' ? 'JACKPOT' : resolvedType === 'hof' ? 'HALL OF FAME' : 'PRO'}
              </span>
              {/* Use the global league number from contestName ("BBB #N"
                  / "League #N") as the proof URL — NOT draft.id. The
                  slot-id counter (per-speed-per-year) has desynced from
                  the global FilledLeaguesCount, so passing draft.id
                  leads to the wrong batch's proof.
                  contestName comes in several shapes ("BBB #802",
                  "League #802", and per-queue forms like "Jackpot #5").
                  Match the trailing "#N" — but exclude queue drafts
                  via draft.id since their N is a queue ordinal, not a
                  league number. */}
              {(() => {
                const isQueueDraft = !/^\d{4}-(fast|slow)-draft-\d+$/.test(draft.id);
                let leagueDraftId: string | undefined;
                if (!isQueueDraft) {
                  const m = /#\s*(\d+)\s*$/.exec(draft.contestName || '');
                  if (m) leagueDraftId = m[1];
                }
                return (
                  <VerifiedBadge
                    type="draft-type"
                    draftType={resolvedType}
                    size="sm"
                    draftId={leagueDraftId}
                  />
                );
              })()}
            </>
          ) : (
            <span className="text-white/30 text-sm italic">Unrevealed</span>
          )}
          {draft.id && <FounderPill draftId={draft.id} size="sm" />}
        </div>

        <div className="w-28 flex-shrink-0 flex items-center justify-center">
          {effectiveLive.displayPhase === 'filling' ? (
            <div className="flex flex-col items-center gap-1">
              <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${(effectiveLive.playerCount / 10) * 100}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </div>
              <span className="text-xs tabular-nums">
                <span className="text-white font-semibold">{effectiveLive.playerCount}</span>
                <span className="text-white/40">/10</span>
              </span>
            </div>
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
            <span className="text-white/50 text-sm">Reveal in {effectiveLive.countdown}s</span>
          ) : effectiveLive.displayPhase === 'draft-starting' ? (
            <span className="text-white/50 text-sm">
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
              const remaining = draft.pickEndTimestamp
                ? Math.max(0, draft.pickEndTimestamp - Date.now() / 1000)
                : (draft.timeRemaining ?? 30);
              const expectedPickLength = draft.draftSpeed === 'fast' ? 30 : 28800;
              const looksUnconfirmed = remaining > expectedPickLength * 0.95;
              if (looksUnconfirmed) {
                return <span className="text-white/30 text-sm">Syncing…</span>;
              }
              return (
                <span className="text-banana font-bold">
                  {formatCountdown(remaining)}
                </span>
              );
            })()
          ) : draft.currentPick != null ? (
            <span className="text-white/50 text-sm">
              {draft.currentPick === 0 ? 'Next up' : `${draft.currentPick} pick${draft.currentPick !== 1 ? 's' : ''} away`}
            </span>
          ) : (
            <span className="text-white/50 text-sm">In progress</span>
          )}
        </div>

        <div className="w-28 flex-shrink-0 flex items-center justify-end gap-2">
          {['filling', 'randomizing', 'pre-spin-countdown', 'draft-starting'].includes(effectiveLive.displayPhase) ? (
            <>
              <Tooltip content="Enter draft room">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDraftClick(draft);
                  }}
                  className="w-20 py-2 rounded-lg font-semibold text-sm transition-all hover:scale-105 bg-white text-black hover:bg-white/90 flex items-center justify-center"
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
              className="w-20 py-2 rounded-lg font-semibold text-sm transition-all hover:scale-105 flex items-center justify-center"
              style={{
                backgroundColor: isYourTurn ? '#fbbf24' : accentColor,
                color: isYourTurn ? '#000' : '#fff',
              }}
            >
              {isYourTurn ? 'Pick Now' : 'Enter'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
