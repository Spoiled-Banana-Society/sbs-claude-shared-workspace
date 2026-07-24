'use client';

import { useLiveDraftActivity } from '@/hooks/useLiveDraftActivity';

/**
 * The "keep waiting" nudge: "5 drafts going · a draft is on Round 14".
 *
 * Renders nothing (returns null) whenever there's nothing to show — feature flag
 * off, zero in-progress fast drafts, or a stale/dead aggregator. The wording is
 * identical everywhere it appears (lobby, draft room) and matches the fill-alert
 * feed, all sourced from one RTDB value so they can never disagree.
 *
 * Pass `className` to tune outer spacing per placement.
 */
export default function LiveDraftActivityLine({ className = '' }: { className?: string }) {
  const activity = useLiveDraftActivity();
  if (!activity) return null;

  const { count, round } = activity;
  const noun = count === 1 ? 'draft' : 'drafts';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-white/70 ${className}`}
    >
      {/* Solid "live" dot — crisp, no glow; a gentle pulse only when motion is allowed. */}
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 motion-safe:animate-pulse"
      />
      <span className="tabular-nums">
        {count} {noun} going <span className="text-white/30">·</span> a draft is on{' '}
        <span className="font-semibold text-banana">Round {round}</span>
      </span>
    </div>
  );
}
