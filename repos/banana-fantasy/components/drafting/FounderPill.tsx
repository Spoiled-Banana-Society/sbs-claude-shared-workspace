'use client';

import React, { useEffect, useState } from 'react';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';
import { isFounderDraft, type DraftOrderEntry } from '@/lib/founderDraft';

// Cyan "FOUNDER" pill that renders next to the existing draft-type pill
// (JP/HOF/Pro). Two ways to use it:
//
//  1. Pass `draftStartTimeUnixSec` + `draftOrder` directly when the
//     consumer already has the Go API data (e.g., draft-room page).
//
//  2. Pass just `draftId` and the pill fetches the Go API state/info
//     itself (no-op if the draft doesn't exist yet — pre-fill phase).

const FOUNDER_CYAN = '#06b6d4';

interface BaseProps {
  size?: 'sm' | 'md';
}

interface DataProps extends BaseProps {
  draftStartTimeUnixSec: number | null | undefined;
  draftOrder: DraftOrderEntry[] | null | undefined;
  draftId?: never;
}

interface FetchProps extends BaseProps {
  draftId: string;
  draftStartTimeUnixSec?: never;
  draftOrder?: never;
}

type FounderPillProps = DataProps | FetchProps;

interface DraftInfoLite {
  draftStartTime?: number;
  draftOrder?: DraftOrderEntry[];
}

export function FounderPill(props: FounderPillProps) {
  const { schedule, loaded } = useFounderSchedule();
  const [fetched, setFetched] = useState<DraftInfoLite | null>(null);
  const draftId = 'draftId' in props ? props.draftId : null;

  useEffect(() => {
    if (!draftId) return;
    if (!loaded || !schedule.active) return;
    let cancelled = false;
    fetch(`/api/spectate/draft-state?draftId=${encodeURIComponent(draftId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.info) return;
        setFetched({
          draftStartTime: data.info.draftStartTime,
          draftOrder: data.info.draftOrder,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [draftId, loaded, schedule.active]);

  if (!loaded) return null;

  const startTime = 'draftStartTimeUnixSec' in props
    ? props.draftStartTimeUnixSec
    : fetched?.draftStartTime;
  const order = 'draftOrder' in props
    ? props.draftOrder
    : fetched?.draftOrder;

  if (!isFounderDraft(startTime, order, schedule)) return null;

  const sizing = props.size === 'md'
    ? 'text-[11px] px-2.5 py-0.5'
    : 'text-[10px] px-2 py-0.5';

  return (
    <span
      className={`${sizing} rounded-full font-bold uppercase tracking-wider`}
      style={{
        background: `${FOUNDER_CYAN}33`, // 20% alpha
        color: FOUNDER_CYAN,
        border: `1px solid ${FOUNDER_CYAN}55`,
      }}
    >
      Founder
    </span>
  );
}
