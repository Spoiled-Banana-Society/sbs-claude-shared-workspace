'use client';

/**
 * System-health pill in the admin top bar — always visible.
 *
 * Polls the same data the Dashboard's HealthCard uses, distilled to a
 * single dot + word: Healthy / Needs a look / Attention required.
 * Click jumps to the Dashboard where the full health breakdown lives.
 *
 * Phase 3 addition. The whole point: no matter which tab Boris is on,
 * he can see at a glance whether the system is happy or whether
 * something needs immediate attention.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useAdminMetrics, useRecentErrors, useResolvedErrors, type ErrorEventEntry } from '@/hooks/admin/useAdminApi';
import { dropResolvedEvents } from '@/lib/errorGrouping';

type Level = 'ok' | 'warn' | 'critical';

function computeLevel(errors: ErrorEventEntry[] | undefined, pendingWithdrawals: number | undefined): Level {
  const list = errors ?? [];
  const oneHourAgo = Date.now() - 3_600_000;
  const recent = list.filter((e) => new Date(e.timestamp).getTime() > oneHourAgo);
  const critical = recent.filter((e) => /critical|fatal|crash|panic/i.test(e.source) || /critical|crash/i.test(e.message));
  if (critical.length > 0) return 'critical';
  if ((pendingWithdrawals ?? 0) > 20) return 'critical';
  const lowSrc = (s: string) => /watchdog|prefs|rtdb/i.test(s);
  const warns = recent.filter((e) => !critical.includes(e) && !lowSrc(e.source));
  if (warns.length > 3) return 'warn';
  if ((pendingWithdrawals ?? 0) >= 5) return 'warn';
  if (warns.length > 0) return 'warn';
  return 'ok';
}

export function HealthPill({ enabled }: { enabled: boolean }) {
  const metricsQ = useAdminMetrics(enabled);
  const errorsQ = useRecentErrors(enabled);
  const resolvedQ = useResolvedErrors(enabled);
  // Same resolved-aware (recurrence-aware) filter as the dashboard + feed.
  const activeErrors = useMemo(
    () => dropResolvedEvents(errorsQ.data?.errors ?? [], resolvedQ.data?.resolved),
    [errorsQ.data, resolvedQ.data],
  );
  const level = computeLevel(activeErrors, metricsQ.data?.withdrawals.pending);

  const palette = {
    ok: { dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.05]', label: 'Healthy' },
    warn: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/30', bg: 'bg-amber-500/[0.05]', label: 'Needs a look' },
    critical: { dot: 'bg-red-400', text: 'text-red-300', border: 'border-red-500/40', bg: 'bg-red-500/[0.06]', label: 'Attention' },
  }[level];

  return (
    <Link
      href="/admin?tab=dashboard"
      className={`shrink-0 inline-flex items-center gap-2 px-3 h-9 rounded-md border ${palette.border} ${palette.bg} ${palette.text} text-xs font-medium hover:brightness-110 transition`}
      title="System health — click for Dashboard"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${palette.dot} ${level !== 'ok' ? 'animate-pulse' : ''}`} />
      <span className="hidden sm:inline">{palette.label}</span>
    </Link>
  );
}
