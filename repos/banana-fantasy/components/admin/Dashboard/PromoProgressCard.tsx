'use client';

/**
 * Promo progress — per-type table + stale starters list.
 *
 * Apple-clean rewrite (May 2026): no progress bars, no color-flooded
 * banners. One dense table for the per-type breakdown, one inline list
 * for stale starters, matching the rest of the Dashboard's hairline-
 * divider aesthetic.
 *
 * Boris's spec: a user has "started" a promo the moment they do at
 * least one of its steps (not just by opening the modal). The endpoint
 * walks every user's promos subcollection and surfaces:
 *   - per-type: started / completed / pending / conversion rate
 *   - stale list: in-progress + no activity in 48h (the cohort to DM)
 */

import { usePromoProgress } from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

interface Props {
  enabled: boolean;
}

export function PromoProgressCard({ enabled }: Props) {
  const q = usePromoProgress(enabled);
  const data = q.data;

  if (q.isLoading) {
    return (
      <Section title="Promos — progress & stale starters">
        <Card>
          <p className="px-5 py-4 text-sm text-gray-400">Loading…</p>
        </Card>
      </Section>
    );
  }
  if (q.isError) {
    return (
      <Section title="Promos — progress & stale starters">
        <div className="rounded-2xl border border-red-500/40 bg-red-500/[0.06] px-5 py-4 text-sm text-red-200">
          Promo progress unavailable. {q.error?.message}
        </div>
      </Section>
    );
  }
  if (!data || (data.pendingTotal === 0 && Object.keys(data.perType).length === 0)) {
    return null;
  }

  const rows = Object.entries(data.perType)
    .filter(([, b]) => b.started > 0 || b.completed > 0)
    .sort((a, b) => b[1].started - a[1].started);

  return (
    <Section title="Promos — progress & stale starters" sub={`${data.pendingTotal} pending · scanned ${data.scannedDocs.toLocaleString()} promo docs`}>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-4 pb-2 text-left font-medium">Type</th>
              <th className="pt-4 pb-2 text-right font-medium">Started</th>
              <th className="pt-4 pb-2 text-right font-medium">Done</th>
              <th className="pt-4 pb-2 text-right font-medium">Pending</th>
              <th className="px-5 pt-4 pb-2 text-right font-medium">Conversion</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-xs text-gray-500">
                  No promo activity yet. Multi-step promos appear here once a user does step 1.
                </td>
              </tr>
            ) : (
              rows.map(([type, b]) => {
                const ratePct = (b.conversionRate * 100).toFixed(0);
                const rateColor =
                  b.conversionRate >= 0.5 ? 'text-emerald-300' :
                  b.conversionRate >= 0.2 ? 'text-amber-300' :
                  'text-red-300';
                return (
                  <tr key={type} className="border-t border-white/[0.06]">
                    <td className="px-5 py-2.5 text-white capitalize">{type.replace(/-/g, ' ')}</td>
                    <td className="py-2.5 text-right text-gray-200">{b.started.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-emerald-300">{b.completed.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-amber-300">{b.pending.toLocaleString()}</td>
                    <td className={`px-5 py-2.5 text-right ${rateColor}`}>{b.started > 0 ? `${ratePct}%` : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {data.stalePending.length > 0 && (
          <>
            <div className="px-5 pt-4 pb-2 border-t border-white/[0.06] flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-white">Stale starters</h4>
              <p className="text-[11px] text-gray-500">
                pending 48h+ · {data.stalePending.length} {data.stalePending.length === 1 ? 'user' : 'users'} to DM
              </p>
            </div>
            <ul className="px-5 pb-4 max-h-72 overflow-y-auto">
              {data.stalePending.map((p) => (
                <li
                  key={`${p.wallet}-${p.promoId}`}
                  className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.04] last:border-0"
                >
                  <WalletLink wallet={p.wallet} bare className="!text-xs !text-gray-200 hover:!text-banana" />
                  <span className="text-[11px] text-gray-400 capitalize">
                    {p.promoType.replace(/-/g, ' ')} · {p.progress}/{p.progressMax}
                  </span>
                  <span className="text-[11px] text-amber-300 shrink-0 tabular-nums">
                    {p.hoursStale !== null ? `${p.hoursStale}h` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {data.warning && (
          <p className="border-t border-amber-500/20 bg-amber-500/[0.05] px-5 py-2 text-[11px] text-amber-300">
            ⚠️ {data.warning}
          </p>
        )}
      </Card>
    </Section>
  );
}

/* Local section/card helpers — keep this file self-contained so it can
   live independently of DashboardPanel's primitives. */

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
