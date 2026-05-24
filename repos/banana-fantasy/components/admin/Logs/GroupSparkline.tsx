'use client';

/**
 * Per-group error sparkline. Takes the raw timestamps of every event in
 * the group, buckets them into N equal-width time bins covering the last
 * 7 days, and renders a tiny inline trend line.
 *
 * One picture says more than "3 in 24h · 7 in 7d" alone — Boris can
 * see at a glance whether the error is spiking right now, decaying
 * since a fix, or steady-state background noise.
 */

import { useMemo } from 'react';
import { Sparkline } from '@/components/admin/Sparkline';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BINS = 14; // ~12h per bin over 7 days — coarse enough to be smooth

interface Props {
  timestamps: number[];
  /** Optional override of the spark color (CSS). */
  color?: string;
}

export function GroupSparkline({ timestamps, color }: Props) {
  const series = useMemo(() => {
    if (timestamps.length < 2) return [];
    const now = Date.now();
    const start = now - WINDOW_MS;
    const buckets = new Array(BINS).fill(0);
    for (const ts of timestamps) {
      if (ts < start || ts > now) continue;
      const idx = Math.min(BINS - 1, Math.floor(((ts - start) / WINDOW_MS) * BINS));
      buckets[idx] += 1;
    }
    return buckets;
  }, [timestamps]);

  if (series.length < 2) return null;
  return (
    <span
      className="inline-flex items-center gap-1"
      title="Frequency over the last 7 days (oldest → newest)"
    >
      <Sparkline values={series} width={64} height={14} color={color} />
    </span>
  );
}
