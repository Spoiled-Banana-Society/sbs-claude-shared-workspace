'use client';

/**
 * Withdrawals by age — pending withdrawals bucketed.
 *
 * Apple-clean rewrite (May 2026). Single table inside one card:
 * age bucket / count / dollar total / oldest. No color blocks, no
 * bar visualizations — just numbers with subtle accent on the >7d
 * row when something's overdue.
 */

import Link from 'next/link';
import { useAdminWithdrawals, type AdminWithdrawalItem } from '@/hooks/admin/useAdminApi';

interface Props {
  enabled: boolean;
}

const BUCKETS = [
  { key: 'fresh' as const, label: '< 24h', accent: 'text-emerald-300' },
  { key: '1to3' as const, label: '1 – 3 days', accent: 'text-amber-300' },
  { key: '3to7' as const, label: '3 – 7 days', accent: 'text-orange-300' },
  { key: 'week+' as const, label: '> 7 days', accent: 'text-red-300' },
];

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
  const total = pending.length;

  return (
    <Section title="Withdrawals — pending by age" sub={`${total} pending total`}>
      <Card>
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-baseline justify-between">
          <h4 className="text-sm font-semibold text-white">Stale check</h4>
          <Link href="/admin?tab=money&sub=withdrawals" className="text-[11px] text-gray-400 hover:text-white">
            Open Money →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-3 pb-2 text-left font-medium">Age</th>
              <th className="pt-3 pb-2 text-right font-medium">Count</th>
              <th className="pt-3 pb-2 text-right font-medium">Amount</th>
              <th className="px-5 pt-3 pb-2 text-right font-medium">Oldest</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {BUCKETS.map((b) => {
              const c = counts[b.key];
              return (
                <tr key={b.key} className="border-t border-white/[0.06]">
                  <td className={`px-5 py-2.5 text-sm font-medium ${b.accent}`}>{b.label}</td>
                  <td className="py-2.5 text-right text-white">{c.count.toLocaleString()}</td>
                  <td className="py-2.5 text-right text-gray-300">${c.amount.toLocaleString()}</td>
                  <td className="px-5 py-2.5 text-right text-gray-500">
                    {c.count > 0 ? `${Math.round(c.oldestHours)}h` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {total === 0 && (
          <p className="px-5 py-3 text-center text-[11px] text-gray-500">No pending withdrawals.</p>
        )}
      </Card>
    </Section>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{title}</h3>
        {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">{children}</div>;
}
