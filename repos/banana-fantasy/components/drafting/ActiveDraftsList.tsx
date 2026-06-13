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
  return (
    <>
      {regularDrafts.length > 0 && (
        <div className="space-y-2">
          {regularDrafts.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              live={getLiveState(draft)}
              isCreating={creatingQueueDraft === draft.id}
              onDraftClick={onDraftClick}
              onExitDraft={onExitDraft}
              formatRelativeTime={formatRelativeTime}
              formatCountdown={formatCountdown}
            />
          ))}
        </div>
      )}

      {specialDrafts.length > 0 && (
        <div className="mt-16 mb-4">
          <h2 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 px-2">From the Wheel</h2>
          <div className="space-y-2">
            {specialDrafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                live={getLiveState(draft)}
                isCreating={creatingQueueDraft === draft.id}
                onDraftClick={onDraftClick}
                formatRelativeTime={formatRelativeTime}
                formatCountdown={formatCountdown}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
