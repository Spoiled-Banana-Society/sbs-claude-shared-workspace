'use client';

/**
 * Promo-progress dashboard card.
 *
 * Boris's spec: for multi-step promos (4 daily drafts, Pick 10, etc.)
 * he wants to see who started and didn't finish — separately from total
 * claims. The endpoint walks every user's promos subcollection, buckets
 * by type, and surfaces a "stale starters" list (in-progress + no
 * activity in 48h) so an admin can DM them targeted re-engagement.
 *
 * Per-type table shows: started · completed · pending · conversion rate.
 * The list below shows the top stale starters with clickable wallets
 * (one-click into User Lookup).
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
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-sm text-gray-400">Loading promo progress…</p>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
        Promo progress unavailable. {q.error?.message}
      </div>
    );
  }
  if (!data || (data.pendingTotal === 0 && Object.keys(data.perType).length === 0)) {
    return null;
  }

  const rows = Object.entries(data.perType)
    .filter(([, b]) => b.started > 0 || b.completed > 0)
    .sort((a, b) => b[1].started - a[1].started);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Promos — in progress + completion rate</h3>
        <span className="text-[11px] text-gray-500">
          {data.pendingTotal} pending across all users · scanned {data.scannedDocs.toLocaleString()}
        </span>
      </div>

      {/* Per-type breakdown */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[520px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-2.5 font-medium">Promo type</th>
              <th className="px-4 py-2.5 font-medium text-right">Started</th>
              <th className="px-4 py-2.5 font-medium text-right">Completed</th>
              <th className="px-4 py-2.5 font-medium text-right">Pending</th>
              <th className="px-4 py-2.5 font-medium text-right">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-gray-500">
                  No promo activity scanned. Promos start counting here as soon as a user does their first step.
                </td>
              </tr>
            ) : (
              rows.map(([type, b]) => {
                const ratePct = (b.conversionRate * 100).toFixed(0);
                const ratePctColor =
                  b.conversionRate >= 0.5 ? 'text-emerald-300' :
                  b.conversionRate >= 0.2 ? 'text-yellow-300' :
                  'text-red-300';
                return (
                  <tr key={type} className="border-t border-white/[0.04]">
                    <td className="px-4 py-2.5 text-white capitalize">{type.replace(/-/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-200">{b.started.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-300">{b.completed.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-yellow-300">{b.pending.toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${ratePctColor}`}>{b.started > 0 ? `${ratePct}%` : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Stale starters — users in the middle of a promo who haven't
          moved in 48h. Click any wallet to drill into User Lookup. */}
      {data.stalePending.length > 0 && (
        <div className="border-t border-white/[0.04] px-4 py-3 bg-amber-500/[0.03]">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-amber-300/80">
            Stale starters — pending 48h+ ({data.stalePending.length})
          </p>
          <p className="mb-2 text-[11px] text-gray-400">
            Users who started a multi-step promo and haven&apos;t made progress in 48 hours.
            Good candidates for a targeted re-engagement DM.
          </p>
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {data.stalePending.map((p) => (
              <li
                key={`${p.wallet}-${p.promoId}`}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-amber-500/[0.06]"
              >
                <WalletLink wallet={p.wallet} bare className="!text-xs !text-gray-300 hover:!text-banana" />
                <span className="text-[11px] text-gray-400 capitalize">
                  {p.promoType.replace(/-/g, ' ')} · {p.progress}/{p.progressMax} steps
                </span>
                <span className="text-[10px] text-amber-300 shrink-0">
                  {p.hoursStale !== null ? `${p.hoursStale}h stale` : 'stale'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.warning && (
        <p className="border-t border-amber-500/20 bg-amber-500/[0.05] px-4 py-2 text-[11px] text-amber-300">
          ⚠️ {data.warning}
        </p>
      )}
    </div>
  );
}
