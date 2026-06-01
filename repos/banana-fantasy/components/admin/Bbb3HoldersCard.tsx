'use client';

/**
 * BBB3 holders — returning-user cross-check.
 *
 * Returning-user status is a live on-chain BBB3 balanceOf at login. This panel
 * materialises the full holder list (from the stored snapshot + manual
 * allowlist) so Boris can verify a given holder logged in and is treated as
 * returning — or spot someone wrongly seen as new. Refresh re-snapshots from
 * Eth mainnet via Alchemy.
 */

import { useState } from 'react';
import { useBbb3Holders, useRefreshBbb3Holders, AdminApiError } from '@/hooks/admin/useAdminApi';
import { useToast } from '@/components/ui/Toast';
import { WalletLink } from '@/components/admin/WalletLink';

export function Bbb3HoldersCard({ enabled }: { enabled: boolean }) {
  const q = useBbb3Holders(enabled);
  const refresh = useRefreshBbb3Holders();
  const { show } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [onlyLoggedIn, setOnlyLoggedIn] = useState(false);

  const data = q.data;

  const handleRefresh = async () => {
    try {
      const res = await refresh.mutateAsync();
      show({ level: 'success', message: `Snapshot refreshed — ${res.snapshotCount} BBB3 holders on chain.` });
    } catch (err) {
      const e = err as AdminApiError;
      show({ level: 'error', message: e.message || 'Refresh failed', requestId: e.requestId });
    }
  };

  const holders = (data?.holders ?? []).filter((h) => (onlyLoggedIn ? h.hasAccount : true));

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/40">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">BBB3 Holders — returning players</h3>
          <p className="text-[11px] text-gray-500">
            {q.isLoading
              ? 'Loading…'
              : q.isError
              ? (q.error as AdminApiError)?.message || 'Failed to load'
              : data
              ? `${data.count.toLocaleString()} wallets · ${data.loggedIn.toLocaleString()} logged in · ${data.allowlistCount} allowlisted${data.snapshotAt ? ` · snapshot ${new Date(data.snapshotAt).toLocaleDateString()}` : ' · no snapshot yet'}`
              : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refresh.isPending}
            className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold disabled:opacity-50"
            title="Re-snapshot BBB3 holders from Eth mainnet (Alchemy)"
          >
            {refresh.isPending ? 'Snapshotting…' : 'Refresh snapshot'}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-xs"
          >
            {expanded ? 'Hide list' : 'Show list'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3">
          {!data || data.count === 0 ? (
            <p className="px-2 py-4 text-xs text-gray-500">
              No holders yet. Click “Refresh snapshot” to pull the BBB3 holder list from chain.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 px-1 pb-2 text-[11px] text-gray-400">
                <input type="checkbox" checked={onlyLoggedIn} onChange={(e) => setOnlyLoggedIn(e.target.checked)} />
                Only holders who have logged in
              </label>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-800/90 text-gray-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">Wallet</th>
                      <th className="px-3 py-2">Username</th>
                      <th className="px-3 py-2">Logged in</th>
                      <th className="px-3 py-2">Bought</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.map((h) => (
                      <tr key={h.wallet} className="border-t border-gray-800/60">
                        <td className="px-3 py-1.5 font-mono">
                          <WalletLink wallet={h.wallet} bare className="hover:text-banana" />
                        </td>
                        <td className="px-3 py-1.5 text-gray-300">{h.username || '—'}</td>
                        <td className="px-3 py-1.5">
                          {h.hasAccount ? (
                            <span className="text-green-400">{h.banned ? 'Yes (banned)' : 'Yes'}</span>
                          ) : (
                            <span className="text-gray-600">No</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{h.firstPurchaseBonusGranted ? 'Yes' : '—'}</td>
                        <td className="px-3 py-1.5 text-gray-500">{h.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
