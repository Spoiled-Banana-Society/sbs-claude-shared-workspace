'use client';

/**
 * Promos admin panel — read-only table of promo codes + usage counts.
 *
 * Extracted from app/admin/page.tsx during Phase 3 tab reorg so the
 * Money tab can compose it as a sub-tab alongside Withdrawals,
 * Onramps, and Offramps.
 */

import { useAdminPromos } from '@/hooks/admin/useAdminApi';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PromosPanel({ enabled }: { enabled: boolean }) {
  const query = useAdminPromos(enabled);
  const items = query.data?.promos ?? [];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium text-right">Discount</th>
              <th className="px-4 py-3 font-medium text-right">Uses</th>
              <th className="px-4 py-3 font-medium">Active</th>
              <th className="px-4 py-3 font-medium">Expires</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  {query.isLoading ? 'Loading promos…' : 'No promos yet'}
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-3 font-mono text-xs text-gray-200">{p.code}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{p.discountPercent}%</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">
                    {p.currentUses}
                    {p.maxUses ? `/${p.maxUses}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {p.active ? (
                      <span className="text-green-400 text-xs">●</span>
                    ) : (
                      <span className="text-gray-600 text-xs">○</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.expiresAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
