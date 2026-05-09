'use client';

import { useRecentAdminActions, AdminApiError } from '@/hooks/admin/useAdminApi';

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shorten(v: string) {
  if (!v) return '—';
  return v.length < 14 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function summarize(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string {
  if (!after && !before) return '—';
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...keys]
    .map((k) => {
      const b = (before ?? {})[k];
      const a = (after ?? {})[k];
      if (b === undefined) return `${k}: → ${JSON.stringify(a)}`;
      if (a === undefined) return `${k}: ${JSON.stringify(b)} →`;
      return `${k}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`;
    })
    .join('; ');
}

export function RecentActivity({ enabled }: { enabled: boolean }) {
  const query = useRecentAdminActions(enabled);
  const actions = query.data?.actions ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-white">Recent Admin Activity</h3>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          Refresh
        </button>
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load activity'}
        </div>
      )}

      <div className="rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Change</th>
              <th className="px-4 py-3">Req ID</th>
            </tr>
          </thead>
          <tbody>
            {actions.length === 0 && !query.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No activity yet</td>
              </tr>
            ) : (
              actions.map((a, i) => (
                <tr key={`${a.requestId}-${i}`} className="border-t border-gray-800/50">
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(a.timestamp)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{shorten(a.actor)}</td>
                  <td className="px-4 py-3 text-xs text-[#F3E216]">{a.action}</td>
                  <td className="px-4 py-3 font-mono text-xs">{shorten(a.target)}</td>
                  <td className="px-4 py-3 text-xs text-gray-300">{summarize(a.before, a.after)}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-gray-500">{a.requestId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
