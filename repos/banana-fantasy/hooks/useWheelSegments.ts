'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/appApiClient';
import { wheelSegments, segmentsHaveSpecials, type WheelSegment } from '@/lib/wheelConfig';

interface PeriodResponse {
  active?: boolean;
  period?: {
    periodNumber?: number;
    segments?: WheelSegment[];
    hasJackhof?: boolean;
  } | null;
  /** Server's template for the next period — what to render while no period is active. */
  fallbackSegments?: WheelSegment[];
}

/**
 * The wedge set the wheel should RENDER: the active VRF period's committed
 * segmentsSnapshot (what its outcomes actually derive from), falling back to
 * the static classic config while no period is active or the fetch is in
 * flight. This is what lets a new config generation (e.g. the JackHOF wedge)
 * go live the instant its period activates — no client deploy involved.
 */
export function useWheelSegments(): {
  segments: WheelSegment[];
  segmentAngle: number;
  periodNumber: number | null;
  hasJackhof: boolean;
  /** False once the wheel pays no Jackpot / HOF / JackHOF seat (season mode). */
  hasSpecials: boolean;
} {
  const { data } = useQuery<PeriodResponse>({
    queryKey: ['wheel', 'period-public'],
    queryFn: () => fetchJson<PeriodResponse>('/api/wheel/period'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const periodSegments = data?.active && Array.isArray(data.period?.segments) && data.period.segments.length > 0
    ? data.period.segments
    : null;
  const fallback = Array.isArray(data?.fallbackSegments) && data.fallbackSegments.length > 0 ? data.fallbackSegments : wheelSegments;
  const segments = periodSegments ?? fallback;
  return {
    segments,
    segmentAngle: 360 / segments.length,
    periodNumber: data?.period?.periodNumber ?? null,
    hasJackhof: segments.some((s) => s.id === 'jackhof'),
    hasSpecials: segmentsHaveSpecials(segments),
  };
}
