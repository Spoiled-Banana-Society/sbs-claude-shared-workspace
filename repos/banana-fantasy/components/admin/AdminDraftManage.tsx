'use client';

/**
 * Admin: Drafts → Manage sub-tab.
 *
 * Lets an admin search for any draft in the Go API's `drafts` Firestore
 * collection by status / wallet / id, see who's in it, and delete + refund
 * tokens in one click. Replaces the manual cleanup scripts in the
 * Richard-notes runbook for the common case.
 *
 * Backed by:
 *   GET    /api/admin/drafts/manage      → useAdminDraftsManage
 *   DELETE /api/admin/drafts/manage/[id] → useDeleteDraftWithRefund
 *
 * Both endpoints log under `admin.drafts.manage.*` so ghost-cleanup is
 * traceable in the Logs tab.
 */

import { useMemo, useState } from 'react';
import {
  useAdminDraftsManage,
  useDeleteDraftWithRefund,
  type ManageDraftRow,
  type DraftHealth,
} from '@/hooks/admin/useAdminApi';
import { clientLog } from '@/lib/clientLog';
import { normalizeContestName } from '@/lib/draftStore';

interface Props {
  enabled: boolean;
}

const STATUS_OPTIONS = ['', 'filling', 'drafting', 'completed'] as const;

function shortAddr(a: string): string {
  if (!a) return '';
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Health badge styling — color tells the admin at a glance what's safe to touch.
const HEALTH_BADGE: Record<DraftHealth, { label: string; cls: string }> = {
  completed: { label: 'Completed', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  filling: { label: 'Filling', cls: 'bg-sky-500/15 text-sky-300 border border-sky-500/30' },
  drafting: { label: 'Drafting', cls: 'bg-purple-500/15 text-purple-300 border border-purple-500/30' },
  frozen: { label: '⚠ Frozen', cls: 'bg-red-500/20 text-red-300 border border-red-500/40' },
  unknown: { label: 'Unknown', cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
};

export function AdminDraftManage({ enabled }: Props) {
  const [walletInput, setWalletInput] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [status, setStatus] = useState<typeof STATUS_OPTIONS[number]>('');
  const [appliedFilters, setAppliedFilters] = useState<{
    wallet?: string;
    status?: string;
    query?: string;
  }>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useAdminDraftsManage(
    enabled,
    appliedFilters,
  );
  const deleteMutation = useDeleteDraftWithRefund();

  const applyFilters = () => {
    const filters = {
      wallet: walletInput.trim() || undefined,
      status: status || undefined,
      query: queryInput.trim() || undefined,
    };
    setAppliedFilters(filters);
    clientLog('admin.drafts.manage', 'search', filters);
  };

  const clearFilters = () => {
    setWalletInput('');
    setQueryInput('');
    setStatus('');
    setAppliedFilters({});
    clientLog('admin.drafts.manage', 'clear-filters');
  };

  const handleDelete = async (row: ManageDraftRow) => {
    setResultMessage(null);
    clientLog('admin.drafts.manage', 'delete.start', {
      slotId: row.id,
      players: row.numPlayers,
    });
    try {
      const res = await deleteMutation.mutateAsync({ slotId: row.id });
      clientLog('admin.drafts.manage', 'delete.done', {
        slotId: row.id,
        refundedCount: res.refundedCount,
        failedCount: res.failedLeaves.length,
      });
      setResultMessage(
        `Deleted ${row.id} · refunded ${res.refundedCount}/${res.cardsTotal} token${res.cardsTotal === 1 ? '' : 's'}` +
          (res.failedLeaves.length > 0 ? ` · ${res.failedLeaves.length} leave call(s) failed (see Logs)` : ''),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      clientLog('admin.drafts.manage', 'delete.error', { slotId: row.id, error: msg });
      setResultMessage(`Failed to delete ${row.id}: ${msg}`);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const drafts = data?.drafts ?? [];
  const summary = data?.summary;

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const d of drafts) {
      const key = d.status || 'unknown';
      groups[key] = (groups[key] ?? 0) + 1;
    }
    return groups;
  }, [drafts]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[200px]">
            <span className="block text-xs text-white/60 mb-1">Wallet (exact match)</span>
            <input
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="0x…"
              className="w-full bg-zinc-800 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </label>
          <label className="flex-1 min-w-[200px]">
            <span className="block text-xs text-white/60 mb-1">Search ID / display name</span>
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="2024-fast-draft-…  or  BBB #1201"
              className="w-full bg-zinc-800 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </label>
          <label className="min-w-[140px]">
            <span className="block text-xs text-white/60 mb-1">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof STATUS_OPTIONS[number])}
              className="w-full bg-zinc-800 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || 'all'} value={s}>{s || 'All'}</option>
              ))}
            </select>
          </label>
          <button
            onClick={applyFilters}
            className="px-4 py-2 bg-banana text-black rounded-md text-sm font-semibold hover:scale-105 transition-transform"
          >
            Search
          </button>
          <button
            onClick={clearFilters}
            className="px-3 py-2 bg-zinc-800 border border-white/10 text-white/70 rounded-md text-sm hover:bg-zinc-700"
          >
            Clear
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-2 bg-zinc-800 border border-white/10 text-white/70 rounded-md text-sm hover:bg-zinc-700 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="text-xs text-white/40">
          {summary
            ? `${summary.returned} shown / ${summary.total} total`
            : isLoading
              ? 'Loading…'
              : ''}
          {Object.entries(groupedByStatus).length > 0 && (
            <span className="ml-2">
              · {Object.entries(groupedByStatus).map(([s, n]) => `${s}: ${n}`).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {resultMessage && (
        <div className="rounded-md border border-banana/30 bg-banana/10 px-3 py-2 text-sm text-banana">
          {resultMessage}
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Failed to load: {error?.message ?? 'unknown error'}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-zinc-900/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/80 text-xs uppercase text-white/60">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Slot ID</th>
              <th className="text-left px-3 py-2 font-medium">League</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Players</th>
              <th className="text-left px-3 py-2 font-medium">Owners</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-white/40">
                  No drafts match.
                </td>
              </tr>
            )}
            {drafts.map((row) => (
              <tr key={row.id} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono text-xs text-white/90">{row.id}</td>
                <td className="px-3 py-2 text-white/80">{row.displayName ? normalizeContestName(row.displayName) : <span className="text-white/30">—</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className={`inline-block w-fit px-2 py-0.5 rounded-full text-[10px] font-medium ${HEALTH_BADGE[row.health].cls}`}>
                      {HEALTH_BADGE[row.health].label}
                    </span>
                    {row.health === 'frozen' && row.stalledMinutes != null && (
                      <span className="text-[10px] text-red-300/80">
                        clock expired {row.stalledMinutes}m ago{row.pickNumber != null ? ` · pick ${row.pickNumber}` : ''}
                      </span>
                    )}
                    {row.health === 'drafting' && row.pickNumber != null && (
                      <span className="text-[10px] text-white/40">
                        {row.roundNum != null ? `R${row.roundNum} ` : ''}pick {row.pickNumber}
                      </span>
                    )}
                    {row.health === 'filling' && (
                      <span className="text-[10px] text-white/40">{row.numPlayers}/{row.maxPlayers} joined</span>
                    )}
                    {row.health === 'unknown' && (
                      <span className="text-[10px] text-amber-300/70">no live state — inspect</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-white/80">
                  {row.numPlayers} / {row.maxPlayers}
                  {row.isLocked && <span className="ml-1 text-amber-400" title="Locked">🔒</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap gap-1 max-w-[420px]">
                    {row.owners.length === 0 && <span className="text-white/30">none</span>}
                    {row.owners.map((o) => (
                      <span
                        key={o}
                        title={o}
                        className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/70 font-mono"
                      >
                        {shortAddr(o)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {pendingDeleteId === row.id ? (
                    <div className="flex flex-col items-end gap-1">
                      {(row.health === 'completed' || row.health === 'drafting') && (
                        <span className="text-amber-400 text-[10px] max-w-[200px] text-right">
                          ⚠ This draft looks {row.health === 'completed' ? 'COMPLETED' : 'healthy & actively drafting'} — only delete if you&apos;re sure.
                        </span>
                      )}
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => handleDelete(row)}
                          disabled={deleteMutation.isPending}
                          className="px-2 py-1 text-xs bg-red-500/80 hover:bg-red-500 text-white rounded disabled:opacity-50"
                        >
                          {deleteMutation.isPending ? 'Deleting…' : 'Confirm delete'}
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          disabled={deleteMutation.isPending}
                          className="px-2 py-1 text-xs bg-zinc-800 border border-white/10 text-white/70 rounded hover:bg-zinc-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setPendingDeleteId(row.id)}
                      className="px-2 py-1 text-xs bg-zinc-800 border border-white/10 text-white/70 rounded hover:bg-zinc-700 hover:text-white"
                    >
                      Delete & refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/40">
        Delete &amp; refund will: (1) call the Go API&apos;s /league/{'{id}'}/actions/leave per card to return each token to its
        owner, then (2) wipe the Firestore draft doc + RTDB node. Every step logs under tag
        <code className="mx-1 px-1 bg-white/5 rounded">admin.drafts.manage.*</code> in Logs.
        Protected docs (e.g. <code className="px-1 bg-white/5 rounded">draftTracker</code>) are refused.
      </p>
    </div>
  );
}
