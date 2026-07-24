'use client';

import React from 'react';
import { DraftRow, type Draft, type LiveState } from '@/components/drafting/DraftRow';

interface ActiveDraftsListProps {
  regularDrafts: Draft[];
  specialDrafts: Draft[];
  creatingQueueDraft: string | null;
  getLiveState: (draft: Draft) => LiveState;
  onDraftClick: (draft: Draft) => void;
  onExitDraft: (draft: Draft) => void;
  formatRelativeTime: (timestamp: number) => string;
  formatCountdown: (seconds: number) => string;
}

export function ActiveDraftsList({
  regularDrafts,
  specialDrafts,
  creatingQueueDraft,
  getLiveState,
  onDraftClick,
  onExitDraft,
  formatRelativeTime,
  formatCountdown,
}: ActiveDraftsListProps) {
  // Fast drafts always sit above slow ones, each under its own section
  // header (same divider treatment as "From the Wheel"). Headers only appear
  // when both speeds are present — a single-speed list stays clean.
  const fastDrafts = regularDrafts.filter(d => d.draftSpeed !== 'slow');
  const slowDrafts = regularDrafts.filter(d => d.draftSpeed === 'slow');
  const showSpeedHeaders = fastDrafts.length > 0 && slowDrafts.length > 0;

  const renderRows = (drafts: Draft[], withExit: boolean) =>
    drafts.map((draft) => (
      <DraftRow
        key={draft.id}
        draft={draft}
        live={getLiveState(draft)}
        isCreating={creatingQueueDraft === draft.id}
        onDraftClick={onDraftClick}
        onExitDraft={withExit ? onExitDraft : undefined}
        formatRelativeTime={formatRelativeTime}
        formatCountdown={formatCountdown}
      />
    ));

  return (
    <>
      {fastDrafts.length > 0 && (
        <div>
          {showSpeedHeaders && (
            <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 px-2">Fast Drafts</h2>
          )}
          <div className="space-y-2">{renderRows(fastDrafts, true)}</div>
        </div>
      )}

      {slowDrafts.length > 0 && (
        <div className={fastDrafts.length > 0 ? 'mt-16' : ''}>
          {showSpeedHeaders && (
            <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 px-2">Slow Drafts</h2>
          )}
          <div className="space-y-2">{renderRows(slowDrafts, true)}</div>
        </div>
      )}

      {specialDrafts.length > 0 && (
        <div className="mt-16 mb-4">
          <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 px-2">From the Wheel</h2>
          <div className="space-y-2">{renderRows(specialDrafts, false)}</div>
        </div>
      )}
    </>
  );
}
