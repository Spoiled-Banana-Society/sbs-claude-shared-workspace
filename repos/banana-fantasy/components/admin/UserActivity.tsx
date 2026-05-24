'use client';

import { useRecentUserEvents, AdminApiError } from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// True for a 40-hex Ethereum wallet (with or without 0x prefix). Some
// userId values are Privy DIDs or other identifiers, in which case we
// render them as plain text (no User Lookup target for non-wallets).
function isWallet(v: string): boolean {
  if (!v) return false;
  const hex = v.replace(/^0x/i, '');
  return /^[0-9a-f]{40}$/i.test(hex);
}

const EVENT_COLORS: Record<string, string> = {
  signup: 'text-green-400',
  login: 'text-blue-400',
  x_linked: 'text-purple-400',
  first_purchase: 'text-[#F3E216]',
  wallet_linked: 'text-cyan-400',
};

export function UserActivity({ enabled }: { enabled: boolean }) {
  const query = useRecentUserEvents(enabled);
  const events = query.data?.events ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-white">User Activity — live signups + logins</h3>
        <button
          onClick={() => query.refetch()}
          className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
        >
          Refresh
        </button>
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load user events'}
        </div>
      )}

      <div className="rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !query.isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No events yet</td>
              </tr>
            ) : (
              events.map((e, i) => (
                <tr key={`${e.timestamp}-${i}`} className="border-t border-gray-800/50">
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(e.timestamp)}</td>
                  <td className="px-4 py-3 text-xs">
                    {isWallet(e.userId) ? <WalletLink wallet={e.userId} /> : <span className="font-mono text-gray-400">{e.userId || '—'}</span>}
                  </td>
                  <td className={`px-4 py-3 text-xs font-semibold ${EVENT_COLORS[e.eventType] ?? 'text-gray-300'}`}>
                    {e.eventType}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {e.meta ? JSON.stringify(e.meta) : '—'}
                  </td>
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
