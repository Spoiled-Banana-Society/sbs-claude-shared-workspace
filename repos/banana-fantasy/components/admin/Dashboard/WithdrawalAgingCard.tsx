'use client';

/**
 * Withdrawal aging — pending withdrawals bucketed by age. Surfaces
 * "anything getting stale?" at a glance: fresh / 1-3 days / 3-7 days /
 * a week+ old. Each bucket count is clickable into the Money tab
 * pre-filtered. Reuses the existing withdrawals admin endpoint so
 * there's no new backend work needed.
 */

import { useAdminWithdrawals, type AdminWithdrawalItem } from '@/hooks/admin/useAdminApi';
import Link from 'next/link';

interface Props {
  enabled: boolean;
}

const BUCKETS = [
  { key: 'fresh', label: '< 24h', accent: 'text-emerald-300', bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/30' },
  { key: '1to3', label: '1–3 days', accent: 'text-yellow-300', bg: 'bg-yellow-500/[0.06]', border: 'border-yellow-500/30' },
  { key: '3to7', label: '3–7 days', accent: 'text-orange-300', bg: 'bg-orange-500/[0.06]', border: 'border-orange-500/30' },
  { key: 'week+', label: '> 7 days', accent: 'text-red-300', bg: 'bg-red-500/[0.06]', border: 'border-red-500/40' },
] as const;

function bucketFor(ageHours: number): typeof BUCKETS[number]['key'] {
  if (ageHours < 24) return 'fresh';
  if (ageHours < 72) return '1to3';
  if (ageHours < 168) return '3to7';
  return 'week+';
}

export function WithdrawalAgingCard({ enabled }: Props) {
  const q = useAdminWithdrawals(enabled);
  const items = q.data ?? [];
  const pending = items.filter((w: AdminWithdrawalItem) => w.status === 'pending');

  if (pending.length === 0) return null;

  const now = Date.now();
  const counts: Record<typeof BUCKETS[number]['key'], { count: number; amount: number; oldestHours: number }> = {
    fresh: { count: 0, amount: 0, oldestHours: 0 },
    '1to3': { count: 0, amount: 0, oldestHours: 0 },
    '3to7': { count: 0, amount: 0, oldestHours: 0 },
    'week+': { count: 0, amount: 0, oldestHours: 0 },
  };
  for (const w of pending) {
    const t = w.createdAt ? new Date(w.createdAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const ageHours = (now - t) / 3_600_000;
    const key = bucketFor(ageHours);
    counts[key].count += 1;
    counts[key].amount += w.amount;
    counts[key].oldestHours = Math.max(counts[key].oldestHours, ageHours);
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Withdrawals — pending by age</h3>
        <Link href="/admin?tab=money&sub=withdrawals" className="text-[11px] text-gray-400 hover:text-white">
          Open Money →
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        {BUCKETS.map((b) => {
          const c = counts[b.key];
          return (
            <div
              key={b.key}
              className={`rounded-md border ${b.border} ${b.bg} px-3 py-2.5`}
            >
              <p className={`text-[10px] uppercase tracking-wider ${b.accent}`}>{b.label}</p>
              <p className="text-xl font-bold tabular-nums text-white mt-0.5">{c.count}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                ${c.amount.toLocaleString()}
                {c.count > 0 && c.oldestHours > 0 && (
                  <span className="text-gray-500"> · oldest {Math.round(c.oldestHours)}h</span>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
