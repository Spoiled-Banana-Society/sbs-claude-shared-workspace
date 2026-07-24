'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveDraftActivity } from '@/hooks/useLiveDraftActivity';
import * as draftStore from '@/lib/draftStore';
import type { DraftState } from '@/lib/draftStore';
import { buildDraftRoomUrl } from '@/lib/draftRoomUrl';
import { isStagingMode } from '@/lib/staging';

/**
 * The signed-in wallet's own in-progress fast draft, if any — the one the
 * activity line should deep-link to. Read-only subscription to the draftStore
 * (no hydrate/prune/fetch — this renders inside the draft room too, and must
 * never add network on that page). Prefers the draft where it's your turn,
 * then the furthest-along one.
 */
function useMyGoingFastDraft(): DraftState | null {
  const [target, setTarget] = useState<DraftState | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const wallet = localStorage.getItem('banana-last-wallet')?.toLowerCase();
        const going = draftStore.getActiveDrafts().filter(d =>
          d.draftSpeed === 'fast' &&
          d.status === 'drafting' &&
          !d.id.startsWith('queue-') &&
          (!wallet || d.liveWalletAddress?.toLowerCase() === wallet),
        );
        going.sort((a, b) => {
          if (!!a.isYourTurn !== !!b.isYourTurn) return a.isYourTurn ? -1 : 1;
          return (b.currentPick || 0) - (a.currentPick || 0);
        });
        setTarget(going[0] ?? null);
      } catch {
        setTarget(null);
      }
    };
    read();
    const unsub = draftStore.subscribe(read);
    return () => unsub();
  }, []);

  return target;
}

/**
 * The "keep waiting" nudge: "5 drafts going · a draft is on Round 14".
 *
 * Renders nothing (returns null) whenever there's nothing to show — feature flag
 * off, zero in-progress fast drafts, or a stale/dead aggregator. The wording is
 * identical everywhere it appears (lobby, draft room) and matches the fill-alert
 * feed, all sourced from one RTDB value so they can never disagree.
 *
 * When the signed-in wallet is itself in one of those going drafts, the pill is
 * clickable and jumps straight into that draft room.
 *
 * Pass `className` to tune outer spacing per placement.
 */
export default function LiveDraftActivityLine({ className = '' }: { className?: string }) {
  const router = useRouter();
  const activity = useLiveDraftActivity();
  const myGoingDraft = useMyGoingFastDraft();
  if (!activity) return null;

  const { count, round } = activity;
  const noun = count === 1 ? 'draft' : 'drafts';

  const baseClasses =
    `inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-white/70 ${className}`;

  const inner = (
    <>
      {/* Solid "live" dot — crisp, no glow; a gentle pulse only when motion is allowed. */}
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 motion-safe:animate-pulse"
      />
      <span className="tabular-nums">
        {count} {noun} going <span className="text-white/30">·</span> a draft is on{' '}
        <span className="font-semibold text-banana">Round {round}</span>
      </span>
    </>
  );

  if (!myGoingDraft) {
    return (
      <div role="status" aria-live="polite" className={baseClasses}>
        {inner}
      </div>
    );
  }

  const goToMyDraft = () => {
    const url = buildDraftRoomUrl(myGoingDraft, {
      live: isStagingMode() && !!myGoingDraft.liveWalletAddress,
      wallet: myGoingDraft.liveWalletAddress,
    });
    // From inside /draft-room (the filling screen), do a full load — the
    // room's client state machine can't swap to a different draft in place.
    if (window.location.pathname.startsWith('/draft-room')) {
      window.location.assign(url);
    } else {
      router.push(url);
    }
  };

  return (
    <button
      type="button"
      onClick={goToMyDraft}
      aria-live="polite"
      aria-label="Open your live draft"
      className={`${baseClasses} cursor-pointer transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white/90`}
    >
      {inner}
      {/* You're in one of these drafts — chevron signals the pill jumps there. */}
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-white/40"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
