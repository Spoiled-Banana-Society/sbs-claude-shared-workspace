'use client';

import { useMemo, useState } from 'react';
import { useAdminAudit, type AdminAuditRecord } from '@/hooks/admin/useAdminApi';

const ACTION_FILTERS: { label: string; value: string }[] = [
  { label: 'All actions', value: '' },
  { label: 'Grant drafts', value: 'grant-drafts' },
  { label: 'KYC verify', value: 'kyc-verify' },
  { label: 'KYC revoke', value: 'kyc-revoke' },
  { label: 'Reset user', value: 'reset-user' },
  { label: 'Ban user', value: 'ban-user' },
  { label: 'Unban user', value: 'unban-user' },
  { label: 'Approve withdrawal', value: 'approve-withdrawal' },
  { label: 'Deny withdrawal', value: 'deny-withdrawal' },
];

function fmtWallet(raw: string | null | undefined): string {
  if (!raw) return '—';
  return raw.length < 12 ? raw : `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getTxHash(record: AdminAuditRecord): string | null {
  const after = record.after as Record<string, unknown> | undefined;
  const tx = after?.txHash;
  return typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : null;
}

function summary(record: AdminAuditRecord): string {
  const after = record.after as Record<string, unknown> | undefined;
  const before = record.before as Record<string, unknown> | undefined;
  switch (record.action) {
    case 'grant-drafts': {
      const granted = typeof after?.granted === 'number' ? (after.granted as number) : 0;
      const nowTotal = typeof after?.freeDrafts === 'number' ? (after.freeDrafts as number) : 0;
      const verb = granted > 0 ? `Granted ${granted}` : `Adjusted ${granted}`;
      return `${verb} free draft${Math.abs(granted) !== 1 ? 's' : ''} → now ${nowTotal}`;
    }
    case 'kyc-verify':
      return `Marked ${after?.tier ?? 'KYC'} verified`;
    case 'kyc-revoke':
      return 'Revoked KYC verification';
    case 'reset-user':
      return 'Reset user counters';
    case 'ban-user':
      return 'Banned user';
    case 'unban-user':
      return 'Unbanned user';
    case 'approve-withdrawal':
      return `Approved withdrawal ${after?.withdrawalId ?? ''}`.trim();
    case 'deny-withdrawal':
      return `Denied withdrawal ${after?.withdrawalId ?? ''}`.trim();
    case 'zero-free-drafts':
    case 'reset-queue':
      return `Zeroed ${after?.zeroedUsers ?? 0} users (was ${before?.totalFreeDrafts ?? 0} free drafts total)`;
    default:
      return record.action;
  }
}

export function AuditLog({ enabled }: { enabled: boolean }) {
  const [action, setAction] = useState('');
  const q = useAdminAudit(enabled, 200, action);
  const records = useMemo(() => q.data?.records ?? [], [q.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-[#F3E216]/50"
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-500">
            {q.isLoading ? 'Loading…' : q.isError ? 'Error' : `${records.length} records`}
            {q.isFetching && !q.isLoading ? ' · refreshing…' : ''}
          </span>
        </div>
        <button
          onClick={() => q.refetch()}
          className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-xs text-white"
        >
          Refresh
        </button>
      </div>

      {q.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          Failed to load audit log.
        </div>
      )}

      <div className="rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[720px]">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">Tx</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && !q.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No actions recorded yet.
                </td>
              </tr>
            ) : (
              records.map((r, i) => {
                const tx = getTxHash(r);
                return (
                  <tr key={`${r.timestamp}-${i}`} className="border-t border-gray-800/50">
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtTime(r.timestamp)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex rounded-full px-2 py-0.5 border border-gray-600/50 bg-gray-800/50 text-gray-200 font-mono">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">{fmtWallet(r.actor)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">{fmtWallet(r.target)}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{summary(r)}</td>
                    <td className="px-4 py-3 text-xs">
                      {tx ? (
                        <a
                          href={`https://basescan.org/tx/${tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#F3E216] hover:underline font-mono"
                          title={tx}
                        >
                          {tx.slice(0, 10)}… ↗
                        </a>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
