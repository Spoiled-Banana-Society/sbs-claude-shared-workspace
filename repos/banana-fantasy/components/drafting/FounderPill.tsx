'use client';

import React, { useEffect, useState } from 'react';
import { useFounderSchedule } from '@/hooks/useFounderSchedule';
import { isFounderDraft, type DraftOrderEntry } from '@/lib/founderDraft';

// Cyan "FOUNDER" pill that renders next to the existing draft-type pill
// (JP/HOF/Pro). Source of truth is the server-side `founderDrafts`
// collection — once a draft is marked, it stays marked forever even if
// the founder schedule is changed later. The pill calls
// /api/founder-drafts/check, which returns the persisted flag (and
// auto-promotes drafts that qualify under the current live schedule).
//
// Two ways to use it:
//
//  1. Pass `draftStartTimeUnixSec` + `draftOrder` directly. The pill
//     ALSO does the optimistic client-side `isFounderDraft` check so it
//     renders immediately during a draft fill (before the server has
//     persisted), and the server check arrives shortly after to confirm.
//
//  2. Pass just `draftId` and the pill relies on the server check alone.

// Clean wordmark — no pill background, no border, no glow (Boris 2026-06-16).
// Color is the band's opposite tone (founderWordColor), passed by the caller.
interface BaseProps {
  size?: 'sm' | 'md';
  /** Word color per band (defaults to white). Use founderWordColor(type). */
  color?: string;
}

interface DataProps extends BaseProps {
  draftId: string;
  draftStartTimeUnixSec: number | null | undefined;
  draftOrder: DraftOrderEntry[] | null | undefined;
}

interface FetchProps extends BaseProps {
  draftId: string;
  draftStartTimeUnixSec?: never;
  draftOrder?: never;
}

type FounderPillProps = DataProps | FetchProps;

export function FounderPill(props: FounderPillProps) {
  const { schedule, loaded } = useFounderSchedule();
  const { draftId } = props;
  const [persistedFounder, setPersistedFounder] = useState<boolean | null>(null);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    fetch(`/api/founder-drafts/check?draftId=${encodeURIComponent(draftId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setPersistedFounder(data?.isFounder === true);
      })
      .catch(() => {
        if (!cancelled) setPersistedFounder(false);
      });
    return () => { cancelled = true; };
  }, [draftId]);

  // Optimistic client-side check — only used when the server check
  // hasn't returned yet AND we have draftStartTime + draftOrder data
  // (case 1 above). Lets the pill render instantly during a draft fill
  // instead of waiting for the network round-trip.
  const optimisticEligible = (() => {
    if (!loaded) return false;
    if (!('draftStartTimeUnixSec' in props)) return false;
    return isFounderDraft(props.draftStartTimeUnixSec, props.draftOrder, schedule);
  })();

  const isFounder = persistedFounder === true || (persistedFounder === null && optimisticEligible);
  if (!isFounder) return null;

  // Celebratory cyan pill with a crown — distinct from the PRO/HOF/JP pills so
  // a Founder Draft stands out. Crown-only on mobile (text hidden) so it stays
  // compact and doesn't overflow the tight drafts-list row.
  const md = props.size === 'md';
  const sizing = md ? 'text-[12px] px-2.5 py-1 gap-1.5' : 'text-[10px] px-1.5 sm:px-2 py-0.5 gap-0 sm:gap-1';
  const crown = md ? 'w-3.5 h-3.5' : 'w-3 h-3';

  return (
    <span
      className={`glow-founder inline-flex items-center shrink-0 ${sizing} rounded-full font-black uppercase tracking-wider text-black`}
      style={{ background: 'linear-gradient(90deg, #67e8f9 0%, #06b6d4 100%)' }}
    >
      <svg className={`${crown} fill-black`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7l4 4 5-7 5 7 4-4-1.6 11H4.6L3 7zm1.8 13h14.4v1.6H4.8V20z" />
      </svg>
      <span className={md ? '' : 'hidden sm:inline'}>Founder</span>
    </span>
  );
}
